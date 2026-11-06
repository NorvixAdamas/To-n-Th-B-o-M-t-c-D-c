import { getAll, getOne, count } from '../database/db.js';
import { DOMAIN_LABELS } from './search.js';

export function getPublicStats() {
  const total = (table, where = '1=1') => count(table, where);
  const severity = getAll(
    `SELECT COALESCE(cvss_severity, 'UNKNOWN') AS severity, COUNT(*) AS n
     FROM vulnerabilities GROUP BY cvss_severity ORDER BY n DESC`
  );
  const sources = getOne(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN connector IS NOT NULL THEN 1 ELSE 0 END) AS integrated,
            SUM(CASE WHEN last_sync_at IS NOT NULL THEN 1 ELSE 0 END) AS synced,
            SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS failing
     FROM external_sources`
  );
  const lastSync = getOne(
    `SELECT source_key, status, finished_at FROM source_sync_logs ORDER BY started_at DESC LIMIT 1`
  );

  return {
    articles: total('articles', "status = 'published'"),
    glossary: total('glossary_terms'),
    chemicals: total('chemicals'),
    vulnerabilities: total('vulnerabilities'),
    knownExploited: total('vulnerabilities', 'known_exploited = 1'),
    threatIntel: total('threat_intel'),
    foodRecalls: total('food_safety'),
    research: total('research_articles'),
    legal: total('legal_documents'),
    protocols: total('safety_protocols'),
    cases: total('forensic_cases'),
    sources: {
      total: Number(sources.total || 0),
      integrated: Number(sources.integrated || 0),
      synced: Number(sources.synced || 0),
      failing: Number(sources.failing || 0)
    },
    severity: severity.map((row) => ({ severity: row.severity, count: Number(row.n) })),
    domains: getDomainCounts(),
    lastSync: lastSync || null
  };
}

export function getDomainCounts() {
  const domains = new Map();
  const add = (domain, n) => domains.set(domain, (domains.get(domain) || 0) + Number(n));

  for (const row of getAll('SELECT domain, COUNT(*) AS n FROM articles WHERE status = \'published\' GROUP BY domain')) {
    add(row.domain, row.n);
  }
  for (const row of getAll('SELECT domain, COUNT(*) AS n FROM glossary_terms GROUP BY domain')) {
    add(row.domain, row.n);
  }
  for (const row of getAll("SELECT 'toxicology' AS domain, COUNT(*) AS n FROM chemicals")) add(row.domain, row.n);
  for (const row of getAll("SELECT 'cybersecurity' AS domain, COUNT(*) AS n FROM vulnerabilities")) add(row.domain, row.n);
  for (const row of getAll("SELECT 'food-safety' AS domain, COUNT(*) AS n FROM food_safety")) add(row.domain, row.n);
  for (const row of getAll("SELECT 'safety' AS domain, COUNT(*) AS n FROM safety_protocols")) add(row.domain, row.n);

  return Array.from(domains.entries())
    .map(([key, n]) => ({ key, label: DOMAIN_LABELS[key] || key, count: n }))
    .sort((a, b) => b.count - a.count);
}

export function getAdminOverview() {
  const stats = getPublicStats();
  const users = count('users');
  const sessions = count('sessions', 'revoked_at IS NULL AND expires_at > ?', [new Date().toISOString()]);
  const audit = count('audit_logs');
  const drafts = count('articles', "status = 'draft'");
  const failingSources = getAll(
    `SELECT source_key, name, status, last_error, last_sync_at FROM external_sources
     WHERE status = 'error' ORDER BY last_sync_at DESC LIMIT 10`
  );
  const recentAudit = getAll(
    `SELECT a.id, a.action, a.entity_type, a.entity_id, a.details, a.created_at, COALESCE(a.actor, u.username) AS actor
     FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.created_at DESC LIMIT 8`
  );
  const recentSyncs = getAll(
    `SELECT l.*, s.name FROM source_sync_logs l
     LEFT JOIN external_sources s ON s.source_key = l.source_key
     ORDER BY l.started_at DESC LIMIT 10`
  );
  return { ...stats, users, sessions, audit, drafts, failingSources, recentAudit, recentSyncs };
}
