import { getAll, run } from '../database/db.js';
import { config } from '../config/config.js';
import { normalizeVi } from '../utils/text.js';
import { fetchJson, MissingKeyError } from './http.js';
import { upsertThreat, upsertVulnerability } from './store.js';

const now = () => new Date().toISOString();

function severityFromScore(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return null;
  if (n >= 9) return 'CRITICAL';
  if (n >= 7) return 'HIGH';
  if (n >= 4) return 'MEDIUM';
  if (n > 0) return 'LOW';
  return 'NONE';
}

export async function syncNvd() {
  const end = new Date();
  const start = new Date(end.getTime() - config.nvdSyncDays * 86400000);
  const params = new URLSearchParams({
    resultsPerPage: '100',
    pubStartDate: start.toISOString().replace(/\.\d{3}Z$/, '+00:00'),
    pubEndDate: end.toISOString().replace(/\.\d{3}Z$/, '+00:00')
  });
  const headers = config.apiKeys.nvd ? { apiKey: config.apiKeys.nvd } : {};
  const json = await fetchJson(`https://services.nvd.nist.gov/rest/json/cves/2.0?${params}`, { headers });
  const items = Array.isArray(json.vulnerabilities) ? json.vulnerabilities : [];
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const item of items) {
    const cve = item.cve;
    if (!cve?.id) {
      skipped += 1;
      continue;
    }
    const descriptions = Array.isArray(cve.descriptions) ? cve.descriptions : [];
    const description = descriptions.find((d) => d.lang === 'en')?.value || descriptions[0]?.value || '';
    const metrics = cve.metrics?.cvssMetricV31?.[0] || cve.metrics?.cvssMetricV30?.[0] || cve.metrics?.cvssMetricV2?.[0];
    const cvssData = metrics?.cvssData || {};
    const score = cvssData.baseScore ?? null;
    const weaknesses = (cve.weaknesses || [])
      .flatMap((w) => (w.description || []).map((d) => d.value))
      .filter((v) => v && v.startsWith('CWE-'));
    const cwe = [...new Set(weaknesses)].join(', ') || null;
    const affected = (cve.configurations || [])
      .flatMap((c) => c.nodes || [])
      .flatMap((n) => n.cpeMatch || [])
      .map((m) => m.criteria)
      .filter(Boolean)
      .slice(0, 8)
      .join('; ') || null;

    const status = upsertVulnerability({
      cveId: cve.id,
      title: cve.id,
      description: description.slice(0, 4000),
      cvssScore: score,
      cvssSeverity: cvssData.baseSeverity || severityFromScore(score),
      cvssVector: cvssData.vectorString || null,
      cwe,
      affected,
      remediation: 'Tham chiếu bản vá/khuyến cáo của nhà sản xuất và hướng dẫn giảm thiểu của NVD.',
      publishedAt: cve.published ? new Date(cve.published).toISOString() : null,
      modifiedAt: cve.lastModified ? new Date(cve.lastModified).toISOString() : null,
      sourceUrl: `https://nvd.nist.gov/vuln/detail/${cve.id}`,
      origin: 'nvd',
      license: 'NVD — dữ liệu công khai'
    });
    if (status === 'inserted') inserted += 1; else updated += 1;
  }

  return {
    fetched: items.length, inserted, updated, skipped,
    message: `Đồng bộ ${items.length} CVE trong ${config.nvdSyncDays} ngày gần nhất.`
  };
}

export async function fetchNvdCve(cveId) {
  const headers = config.apiKeys.nvd ? { apiKey: config.apiKeys.nvd } : {};
  const json = await fetchJson(
    `https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=${encodeURIComponent(cveId)}`,
    { headers }
  );
  const item = json.vulnerabilities?.[0];
  if (!item) return null;
  const cve = item.cve;
  const description = (cve.descriptions || []).find((d) => d.lang === 'en')?.value || '';
  const metrics = cve.metrics?.cvssMetricV31?.[0] || cve.metrics?.cvssMetricV30?.[0];
  const data = metrics?.cvssData || {};
  return {
    cve_id: cve.id,
    title: cve.id,
    description,
    cvss_score: data.baseScore ?? null,
    cvss_severity: data.baseSeverity || severityFromScore(data.baseScore),
    cvss_vector: data.vectorString || null,
    cwe_ids: [...new Set((cve.weaknesses || []).flatMap((w) => (w.description || []).map((d) => d.value)))].join(', '),
    published_at: cve.published ? new Date(cve.published).toISOString() : null,
    modified_at: cve.lastModified ? new Date(cve.lastModified).toISOString() : null,
    source_url: `https://nvd.nist.gov/vuln/detail/${cve.id}`,
    data_origin: 'nvd',
    verification_status: 'verified'
  };
}

export async function syncKev() {
  const json = await fetchJson('https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json', {
    timeout: 45000
  });
  const items = Array.isArray(json.vulnerabilities) ? json.vulnerabilities : [];
  let inserted = 0;
  let updated = 0;
  for (const entry of items) {
    if (!entry.cveID) continue;
    const status = upsertVulnerability({
      cveId: entry.cveID,
      title: entry.vulnerabilityName || entry.cveID,
      description: entry.shortDescription || '',
      cvssScore: null,
      knownExploited: true,
      kevAddedAt: entry.dateAdded || null,
      kevDueDate: entry.dueDate || null,
      remediation: entry.requiredAction || 'Áp dụng bản vá hoặc biện pháp giảm thiểu theo CISA KEV.',
      sourceUrl: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog',
      origin: 'cisa-kev',
      license: 'CISA — dữ liệu công khai'
    });
    if (status === 'inserted') inserted += 1; else updated += 1;
  }
  return {
    fetched: items.length, inserted, updated, skipped: 0,
    message: `Đã cập nhật ${items.length} CVE trong danh mục KEV.`
  };
}

export async function syncEpss() {
  const rows = getAll(
    `SELECT cve_id FROM vulnerabilities
     WHERE epss_updated_at IS NULL OR epss_updated_at < ?
     ORDER BY COALESCE(cvss_score, 0) DESC LIMIT 150`,
    [new Date(Date.now() - 86400000).toISOString()]
  );
  if (!rows.length) {
    return { fetched: 0, inserted: 0, updated: 0, skipped: 0, message: 'Không có CVE nào cần cập nhật EPSS.' };
  }
  let updated = 0;
  let skipped = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100).map((r) => r.cve_id);
    const json = await fetchJson(`https://api.first.org/data/v1/epss?cve=${encodeURIComponent(chunk.join(','))}`);
    const data = Array.isArray(json.data) ? json.data : [];
    for (const entry of data) {
      const score = Number(entry.epss);
      const percentile = Number(entry.percentile);
      if (!entry.cve || !Number.isFinite(score)) {
        skipped += 1;
        continue;
      }
      run(
        `UPDATE vulnerabilities SET epss_score = ?, epss_percentile = ?, epss_updated_at = ?, updated_at = ?
         WHERE cve_id = ?`,
        [score, Number.isFinite(percentile) ? percentile : null, now(), now(), entry.cve]
      );
      updated += 1;
    }
  }
  return {
    fetched: rows.length, inserted: 0, updated, skipped,
    message: 'EPSS là điểm dự báo của FIRST, không phải kết luận về khai thác thực tế.'
  };
}

export async function syncCwe() {
  const ids = [79, 89, 20, 125, 787, 416, 22, 352, 434, 502, 611, 918, 798, 862, 863, 732, 94, 77, 78, 119];
  let fetched = 0;
  let inserted = 0;
  let updated = 0;
  const errors = [];
  for (const id of ids) {
    try {
      const json = await fetchJson(`https://cwe-api.mitre.org/api/v1/cwe/weakness/${id}`, { retries: 0, timeout: 15000 });
      const weakness = json.Weaknesses?.[0];
      if (!weakness) continue;
      fetched += 1;
      const status = upsertThreat({
        externalId: `CWE-${weakness.ID}`,
        kind: 'weakness',
        name: weakness.Name,
        description: String(weakness.Description || '').slice(0, 3000),
        source: 'cwe',
        sourceUrl: `https://cwe.mitre.org/data/definitions/${weakness.ID}.html`,
        license: 'MITRE CWE Terms of Use'
      });
      if (status === 'inserted') inserted += 1; else updated += 1;
    } catch (error) {
      errors.push(`CWE-${id}: ${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return {
    fetched, inserted, updated, skipped: errors.length,
    message: errors.length ? `Một số CWE lỗi: ${errors.slice(0, 3).join(' | ')}` : 'Đã cập nhật danh sách CWE trọng yếu.'
  };
}

export async function syncAttack() {
  const json = await fetchJson(
    'https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/enterprise-attack/enterprise-attack.json',
    { timeout: 120000, retries: 1, maxBytes: 80 * 1024 * 1024 }
  );
  const objects = Array.isArray(json.objects) ? json.objects : [];
  const techniques = objects
    .filter((o) => o.type === 'attack-pattern' && !o.revoked && !o.x_mitre_deprecated)
    .slice(0, config.attackMaxTechniques);
  let inserted = 0;
  let updated = 0;
  for (const technique of techniques) {
    const ref = (technique.external_references || []).find((r) => r.source_name === 'mitre-attack' && r.external_id);
    if (!ref) continue;
    const status = upsertThreat({
      externalId: ref.external_id,
      kind: 'technique',
      name: technique.name,
      description: String(technique.description || '').slice(0, 3000),
      tactic: (technique.kill_chain_phases || []).map((p) => p.phase_name).join(', '),
      techniqueId: ref.external_id,
      source: 'mitre-attack',
      sourceUrl: (technique.external_references || []).find((r) => r.url)?.url || `https://attack.mitre.org/techniques/${ref.external_id}/`,
      license: 'MITRE ATT&CK Terms of Use'
    });
    if (status === 'inserted') inserted += 1; else updated += 1;
  }
  return {
    fetched: objects.length, inserted, updated, skipped: 0,
    message: `Đã nhập ${techniques.length} kỹ thuật (giới hạn cấu hình ${config.attackMaxTechniques}).`
  };
}

export async function syncOsv() {
  const packages = [
    { name: 'lodash', ecosystem: 'npm' },
    { name: 'express', ecosystem: 'npm' },
    { name: 'django', ecosystem: 'PyPI' },
    { name: 'requests', ecosystem: 'PyPI' },
    { name: 'org.apache.logging.log4j:log4j-core', ecosystem: 'Maven' }
  ];
  let fetched = 0;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  for (const pkg of packages) {
    try {
      const json = await fetchJson('https://api.osv.dev/v1/query', {
        method: 'POST',
        body: { package: pkg },
        timeout: 45000
      });
      const vulns = Array.isArray(json.vulns) ? json.vulns.slice(0, 40) : [];
      fetched += vulns.length;
      for (const vuln of vulns) {
        if (!vuln.id) {
          skipped += 1;
          continue;
        }
        const severity = (vuln.database_specific?.severity || vuln.ecosystem_specific?.severity || '').toString();
        const status = upsertThreat({
          externalId: vuln.id,
          kind: 'advisory',
          name: vuln.summary || vuln.id,
          description: String(vuln.details || vuln.summary || '').slice(0, 4000),
          indicator: pkg.name,
          severity: severity || null,
          source: 'osv',
          sourceUrl: `https://osv.dev/vulnerability/${vuln.id}`,
          publishedAt: vuln.published || null,
          license: 'OSV — giấy phép theo từng nguồn'
        });
        if (status === 'inserted') inserted += 1; else updated += 1;
      }
    } catch (error) {
      skipped += 1;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return {
    fetched, inserted, updated, skipped,
    message: `Truy vấn OSV cho ${packages.length} gói phần mềm phổ biến.`
  };
}

function abuseHeaders() {
  if (!config.apiKeys.abusech) throw new MissingKeyError('abuse.ch', 'ABUSECH_AUTH_KEY');
  return { 'Auth-Key': config.apiKeys.abusech, 'Content-Type': 'application/json' };
}

export async function syncUrlhaus() {
  const headers = abuseHeaders();
  const json = await fetchJson('https://urlhaus-api.abuse.ch/v1/urls/recent/', {
    method: 'POST', headers, body: {}, timeout: 45000
  });
  const items = (json.urls || []).slice(0, 100);
  let inserted = 0;
  let updated = 0;
  for (const item of items) {
    if (!item.id || !item.url) continue;
    const status = upsertThreat({
      externalId: `URLHAUS-${item.id}`,
      kind: 'malicious-url',
      name: item.threat || item.tags || 'URL độc hại',
      description: `URL: ${item.url} · Trạng thái: ${item.url_status || 'unknown'}`,
      indicator: item.url,
      severity: item.threat || null,
      source: 'urlhaus',
      sourceUrl: item.urlhaus_link || 'https://urlhaus.abuse.ch/',
      firstSeen: item.date_added || null,
      license: 'abuse.ch Terms of Use'
    });
    if (status === 'inserted') inserted += 1; else updated += 1;
  }
  return { fetched: items.length, inserted, updated, skipped: 0, message: 'Chỉ lưu URL/metadata, không tải nội dung trang.' };
}

export async function syncThreatfox() {
  const headers = abuseHeaders();
  const json = await fetchJson('https://threatfox-api.abuse.ch/api/v1/', {
    method: 'POST', headers, body: { query: 'get_iocs', days: 1 }, timeout: 45000
  });
  if (json.query_status === 'no_result') {
    return { fetched: 0, inserted: 0, updated: 0, skipped: 0, message: 'Không có IOC mới trong 24 giờ.' };
  }
  const items = Array.isArray(json.data) ? json.data.slice(0, 100) : [];
  let inserted = 0;
  let updated = 0;
  for (const item of items) {
    if (!item.id) continue;
    const status = upsertThreat({
      externalId: `THREATFOX-${item.id}`,
      kind: 'ioc',
      name: item.malware_printable || item.threat_type || 'IOC',
      description: `${item.ioc_type || 'IOC'}: ${item.ioc || ''} · ${item.threat_type || ''}`,
      indicator: item.ioc || null,
      malwareFamily: item.malware_printable || null,
      severity: item.confidence_level ? `Độ tin cậy ${item.confidence_level}%` : null,
      source: 'threatfox',
      sourceUrl: 'https://threatfox.abuse.ch/',
      firstSeen: item.first_seen || null,
      license: 'abuse.ch Terms of Use'
    });
    if (status === 'inserted') inserted += 1; else updated += 1;
  }
  return { fetched: items.length, inserted, updated, skipped: 0, message: 'IOC chỉ mang tính tham khảo, cần xác minh trước khi chặn.' };
}

export async function syncMalwarebazaar() {
  const headers = abuseHeaders();
  const json = await fetchJson('https://mb-api.abuse.ch/api/v1/', {
    method: 'POST', headers, body: { query: 'get_recent', selector: 'time' }, timeout: 45000
  });
  const items = Array.isArray(json.data) ? json.data.slice(0, 100) : [];
  let inserted = 0;
  let updated = 0;
  for (const item of items) {
    if (!item.sha256_hash) continue;
    const status = upsertThreat({
      externalId: `MB-${item.sha256_hash}`,
      kind: 'malware-sample',
      name: item.signature || item.file_type || 'Mẫu malware',
      description: `SHA-256: ${item.sha256_hash} · Loại: ${item.file_type || 'unknown'} · Không tải mẫu.`,
      indicator: item.sha256_hash,
      malwareFamily: item.signature || null,
      source: 'malwarebazaar',
      sourceUrl: 'https://bazaar.abuse.ch/',
      firstSeen: item.first_seen || null,
      license: 'abuse.ch Terms of Use'
    });
    if (status === 'inserted') inserted += 1; else updated += 1;
  }
  return { fetched: items.length, inserted, updated, skipped: 0, message: 'Chỉ lưu mã băm và nhãn; không tải tệp mẫu.' };
}

export async function syncPhishtank() {
  if (!config.apiKeys.phishtank) throw new MissingKeyError('PhishTank', 'PHISHTANK_APP_KEY');
  const json = await fetchJson(
    `https://data.phishtank.com/data/${encodeURIComponent(config.apiKeys.phishtank)}/online-valid.json`,
    { timeout: 60000 }
  );
  const items = Array.isArray(json) ? json.slice(0, 150) : [];
  let inserted = 0;
  let updated = 0;
  for (const item of items) {
    if (!item.phish_id || !item.url) continue;
    const status = upsertThreat({
      externalId: `PHISHTANK-${item.phish_id}`,
      kind: 'phishing',
      name: item.target || 'Trang phishing',
      description: `URL: ${item.url} · Đăng ký: ${item.submission_time || ''}`,
      indicator: item.url,
      source: 'phishtank',
      sourceUrl: 'https://phishtank.org/',
      firstSeen: item.submission_time || null,
      license: 'PhishTank Terms'
    });
    if (status === 'inserted') inserted += 1; else updated += 1;
  }
  return { fetched: items.length, inserted, updated, skipped: 0, message: 'Chỉ lưu URL phishing, không truy cập trang.' };
}

export function normalizeSearchText(...values) {
  return normalizeVi(values.filter(Boolean).join(' '));
}
