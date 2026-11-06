import crypto from 'node:crypto';
import { getOne, getAll, run } from '../database/db.js';
import { CONNECTORS, CONNECTOR_KEYS } from '../integrations/connectors.js';
import { fetchNvdCve } from '../integrations/connectors-cyber.js';
import { upsertVulnerability } from '../integrations/store.js';
import { MissingKeyError } from '../integrations/http.js';

const now = () => new Date().toISOString();
const jobs = new Map();

function envValue(name) {
  return name ? process.env[name] || '' : '';
}

export function syncableSources() {
  return getAll(
    `SELECT source_key, name, connector, env_var, access_type, enabled, status, last_sync_at, last_error
     FROM external_sources WHERE connector IS NOT NULL ORDER BY number`
  );
}

export function sourceReady(source) {
  if (!source.connector) {
    return { ready: false, reason: 'Nguồn này chỉ dùng để tham chiếu, chưa có connector.' };
  }
  if (!CONNECTORS[source.connector]) {
    return { ready: false, reason: 'Connector chưa được triển khai.' };
  }
  if (!source.enabled) {
    return { ready: false, reason: 'Nguồn đang bị tắt trong cấu hình.' };
  }
  if (source.access_type === 'key' && source.env_var && !envValue(source.env_var)) {
    return { ready: false, reason: `Cần API key trong ${source.env_var}.` };
  }
  return { ready: true, reason: null };
}

export async function runSync(sourceKey) {
  const source = getOne('SELECT * FROM external_sources WHERE source_key = ?', [sourceKey]);
  if (!source) {
    return { sourceKey, status: 'error', message: 'Không tìm thấy nguồn dữ liệu.' };
  }
  const readiness = sourceReady(source);
  if (!readiness.ready) {
    const message = readiness.reason;
    run(
      `UPDATE external_sources SET status = ?, last_error = ?, updated_at = ? WHERE source_key = ?`,
      [source.access_type === 'key' ? 'key_required' : 'disabled', message, now(), sourceKey]
    );
    run(
      `INSERT INTO source_sync_logs (source_key, status, started_at, finished_at, message)
       VALUES (?, 'skipped', ?, ?, ?)`,
      [sourceKey, now(), now(), message]
    );
    return { sourceKey, status: 'skipped', message };
  }

  const startedAt = now();
  const log = run(
    `INSERT INTO source_sync_logs (source_key, status, started_at, message) VALUES (?, 'running', ?, ?)`,
    [sourceKey, startedAt, `Bắt đầu đồng bộ ${source.name}`]
  );
  const logId = Number(log.lastInsertRowid);
  const startedMs = Date.now();

  try {
    const result = await CONNECTORS[source.connector].run({ source });
    const table = CONNECTORS[source.connector].table;
    const recordCount = getOne(`SELECT COUNT(*) AS n FROM ${table}`)?.n ?? source.record_count;
    run(
      `UPDATE source_sync_logs SET status = 'success', finished_at = ?, fetched = ?, inserted = ?,
         updated = ?, skipped = ?, message = ? WHERE id = ?`,
      [now(), result.fetched || 0, result.inserted || 0, result.updated || 0, result.skipped || 0,
        result.message || null, logId]
    );
    run(
      `UPDATE external_sources SET status = 'ok', last_sync_at = ?, last_error = NULL,
         record_count = ?, updated_at = ? WHERE source_key = ?`,
      [now(), Number(recordCount), now(), sourceKey]
    );
    return {
      sourceKey, status: 'success', durationMs: Date.now() - startedMs,
      ...result, recordCount: Number(recordCount)
    };
  } catch (error) {
    const missing = error instanceof MissingKeyError || error.code === 'missing_api_key';
    run(
      `UPDATE source_sync_logs SET status = ?, finished_at = ?, message = ? WHERE id = ?`,
      [missing ? 'skipped' : 'error', now(), error.message || 'Lỗi không xác định', logId]
    );
    run(
      `UPDATE external_sources SET status = ?, last_error = ?, last_sync_at = ?, updated_at = ? WHERE source_key = ?`,
      [missing ? 'key_required' : 'error', error.message || 'Lỗi không xác định', now(), now(), sourceKey]
    );
    return {
      sourceKey,
      status: missing ? 'skipped' : 'error',
      durationMs: Date.now() - startedMs,
      message: error.message || 'Lỗi không xác định'
    };
  }
}

async function runMany(keys) {
  const selected = keys && keys.length ? keys : CONNECTOR_KEYS;
  const results = [];
  for (const key of selected) {
    results.push(await runSync(key));
  }
  return results;
}

export function startSyncJob(keys, actor = 'system') {
  const jobId = crypto.randomUUID();
  const job = {
    id: jobId,
    actor,
    status: 'running',
    startedAt: now(),
    finishedAt: null,
    results: null,
    error: null,
    keys: keys && keys.length ? keys : CONNECTOR_KEYS
  };
  jobs.set(jobId, job);
  // Chỉ giữ 20 job gần nhất.
  if (jobs.size > 20) {
    const oldest = [...jobs.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt))[0];
    jobs.delete(oldest.id);
  }

  setImmediate(async () => {
    try {
      job.results = await runMany(job.keys);
      job.status = job.results.some((r) => r.status === 'error') ? 'partial' : 'success';
    } catch (error) {
      job.status = 'error';
      job.error = error.message;
    } finally {
      job.finishedAt = now();
    }
  });

  return job;
}

export function getSyncJob(id) {
  return jobs.get(id) || null;
}

export function recentSyncLogs(limit = 20) {
  return getAll(
    `SELECT l.*, s.name AS source_name FROM source_sync_logs l
     LEFT JOIN external_sources s ON s.source_key = l.source_key
     ORDER BY l.started_at DESC LIMIT ?`,
    [limit]
  );
}

export async function lookupCve(cveId) {
  const normalized = String(cveId || '').toUpperCase();
  if (!/^CVE-\d{4}-\d{4,7}$/.test(normalized)) return null;
  const existing = getOne('SELECT * FROM vulnerabilities WHERE cve_id = ?', [normalized]);
  const fresh = existing && existing.modified_at &&
    Date.now() - new Date(existing.modified_at).getTime() < 12 * 3600 * 1000;
  if (existing && fresh) return { row: existing, cached: true };
  try {
    const data = await fetchNvdCve(normalized);
    if (!data) return existing ? { row: existing, cached: true } : null;
    upsertVulnerability({
      cveId: data.cve_id,
      title: data.title,
      description: data.description,
      cvssScore: data.cvss_score,
      cvssSeverity: data.cvss_severity,
      cvssVector: data.cvss_vector,
      cwe: data.cwe_ids,
      publishedAt: data.published_at,
      modifiedAt: data.modified_at,
      sourceUrl: data.source_url,
      origin: 'nvd',
      license: 'NVD — dữ liệu công khai'
    });
    const row = getOne('SELECT * FROM vulnerabilities WHERE cve_id = ?', [normalized]);
    return { row, cached: false };
  } catch {
    return existing ? { row: existing, cached: true } : null;
  }
}

export function syncSummary() {
  const total = getOne('SELECT COUNT(*) AS n FROM external_sources').n;
  const integrated = getOne('SELECT COUNT(*) AS n FROM external_sources WHERE connector IS NOT NULL').n;
  const keyed = getOne("SELECT COUNT(*) AS n FROM external_sources WHERE access_type = 'key'").n;
  const reference = getOne("SELECT COUNT(*) AS n FROM external_sources WHERE connector IS NULL").n;
  return { total: Number(total), integrated: Number(integrated), keyed: Number(keyed), reference: Number(reference) };
}

export { runMany as runSyncMany };
