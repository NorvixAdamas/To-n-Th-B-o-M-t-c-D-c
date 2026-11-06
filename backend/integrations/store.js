import { getDb, getOne } from '../database/db.js';
import { normalizeVi } from '../utils/text.js';

const now = () => new Date().toISOString();

export function upsertVulnerability(v) {
  const db = getDb();
  const timestamp = now();
  const searchNorm = normalizeVi([
    v.cveId, v.title, v.description, v.cwe, v.affected, v.remediation
  ].filter(Boolean).join(' '));
  const existing = getOne('SELECT id FROM vulnerabilities WHERE cve_id = ?', [v.cveId]);
  if (existing) {
    db.prepare(
      `UPDATE vulnerabilities SET
         title = CASE WHEN locked = 1 THEN title ELSE COALESCE(?, title) END,
         description = CASE WHEN locked = 1 THEN description ELSE COALESCE(?, description) END,
         cvss_score = COALESCE(cvss_score, ?),
         cvss_severity = COALESCE(cvss_severity, ?),
         cvss_vector = COALESCE(cvss_vector, ?),
         cwe_ids = COALESCE(?, cwe_ids),
         affected_products = COALESCE(?, affected_products),
         remediation = COALESCE(?, remediation),
         known_exploited = MAX(known_exploited, ?),
         kev_added_at = COALESCE(?, kev_added_at),
         kev_due_date = COALESCE(?, kev_due_date),
         published_at = COALESCE(?, published_at),
         modified_at = COALESCE(?, modified_at),
         source_url = COALESCE(?, source_url),
         updated_at = ?,
         search_norm = CASE WHEN locked = 1 THEN search_norm ELSE ? END
       WHERE cve_id = ?`
    ).run(
      v.title || null, v.description || null, v.cvssScore ?? null, v.cvssSeverity || null, v.cvssVector || null,
      v.cwe || null, v.affected || null, v.remediation || null, v.knownExploited ? 1 : 0,
      v.kevAddedAt || null, v.kevDueDate || null, v.publishedAt || null, v.modifiedAt || null,
      v.sourceUrl || null, timestamp, searchNorm, v.cveId
    );
    return 'updated';
  }
  db.prepare(
    `INSERT INTO vulnerabilities (cve_id, title, description, cvss_score, cvss_severity, cvss_vector, cwe_ids,
       affected_products, remediation, known_exploited, kev_added_at, kev_due_date, published_at, modified_at,
       source_url, data_origin, verification_status, license, created_at, updated_at, search_norm)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'verified', ?, ?, ?, ?)`
  ).run(
    v.cveId, v.title || v.cveId, v.description || '', v.cvssScore ?? null, v.cvssSeverity || null,
    v.cvssVector || null, v.cwe || null, v.affected || null, v.remediation || null, v.knownExploited ? 1 : 0,
    v.kevAddedAt || null, v.kevDueDate || null, v.publishedAt || null, v.modifiedAt || null,
    v.sourceUrl || null, v.origin || 'nvd', v.license || 'Dữ liệu công khai', timestamp, timestamp, searchNorm
  );
  return 'inserted';
}

export function upsertThreat(t) {
  const db = getDb();
  const timestamp = now();
  const searchNorm = normalizeVi([
    t.externalId, t.name, t.description, t.tactic, t.techniqueId, t.indicator, t.malwareFamily
  ].filter(Boolean).join(' '));
  const existing = getOne('SELECT id FROM threat_intel WHERE external_id = ? AND source = ?', [t.externalId, t.source]);
  if (existing) {
    db.prepare(
      `UPDATE threat_intel SET name = ?, description = ?, tactic = COALESCE(?, tactic),
         technique_id = COALESCE(?, technique_id), malware_family = COALESCE(?, malware_family),
         indicator = COALESCE(?, indicator), severity = COALESCE(?, severity), source_url = COALESCE(?, source_url),
         first_seen = COALESCE(?, first_seen), published_at = COALESCE(?, published_at),
         updated_at = ?, search_norm = ? WHERE id = ?`
    ).run(
      t.name, t.description || '', t.tactic || null, t.techniqueId || null, t.malwareFamily || null,
      t.indicator || null, t.severity || null, t.sourceUrl || null, t.firstSeen || null,
      t.publishedAt || null, timestamp, searchNorm, existing.id
    );
    return 'updated';
  }
  db.prepare(
    `INSERT INTO threat_intel (external_id, kind, name, description, tactic, technique_id, malware_family,
       indicator, severity, source, source_url, data_origin, verification_status, license,
       first_seen, published_at, created_at, updated_at, search_norm)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'verified', ?, ?, ?, ?, ?, ?)`
  ).run(
    t.externalId, t.kind || 'advisory', t.name, t.description || '', t.tactic || null, t.techniqueId || null,
    t.malwareFamily || null, t.indicator || null, t.severity || null, t.source, t.sourceUrl || null,
    t.source, t.license || 'Xem điều khoản nguồn', t.firstSeen || null, t.publishedAt || null,
    timestamp, timestamp, searchNorm
  );
  return 'inserted';
}

export function upsertFood(f) {
  const db = getDb();
  const timestamp = now();
  const searchNorm = normalizeVi([
    f.product, f.reason, f.company, f.distribution, f.classification, f.externalId
  ].filter(Boolean).join(' '));
  const existing = getOne('SELECT id FROM food_safety WHERE external_id = ? AND source = ?', [f.externalId, f.source]);
  if (existing) {
    db.prepare(
      `UPDATE food_safety SET product = ?, reason = COALESCE(?, reason), company = COALESCE(?, company),
         distribution = COALESCE(?, distribution), classification = COALESCE(?, classification),
         country = COALESCE(?, country), recall_date = COALESCE(?, recall_date),
         source_url = COALESCE(?, source_url), updated_at = ?, search_norm = ? WHERE id = ?`
    ).run(
      f.product, f.reason || null, f.company || null, f.distribution || null, f.classification || null,
      f.country || null, f.recallDate || null, f.sourceUrl || null, timestamp, searchNorm, existing.id
    );
    return 'updated';
  }
  db.prepare(
    `INSERT INTO food_safety (external_id, kind, product, reason, company, distribution, classification, country,
       recall_date, source, source_url, data_origin, verification_status, license, created_at, updated_at, search_norm)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'verified', ?, ?, ?, ?)`
  ).run(
    f.externalId, f.kind || 'recall', f.product, f.reason || '', f.company || null, f.distribution || null,
    f.classification || null, f.country || null, f.recallDate || null, f.source, f.sourceUrl || null,
    f.source, f.license || 'Dữ liệu công khai', timestamp, timestamp, searchNorm
  );
  return 'inserted';
}

export function upsertDrug(d) {
  const db = getDb();
  const timestamp = now();
  const searchNorm = normalizeVi([d.brandName, d.genericName, d.warnings, d.foodEffect].filter(Boolean).join(' '));
  const existing = getOne('SELECT id FROM drug_reference WHERE external_id = ? AND source = ?', [d.externalId, d.source]);
  if (existing) {
    db.prepare(
      `UPDATE drug_reference SET brand_name = COALESCE(?, brand_name), generic_name = COALESCE(?, generic_name),
         warnings = COALESCE(?, warnings), food_effect = COALESCE(?, food_effect), updated_at = ?, search_norm = ?
       WHERE id = ?`
    ).run(d.brandName || null, d.genericName || null, d.warnings || null, d.foodEffect || null, timestamp, searchNorm, existing.id);
    return 'updated';
  }
  db.prepare(
    `INSERT INTO drug_reference (external_id, brand_name, generic_name, warnings, food_effect, source,
       source_url, verification_status, created_at, updated_at, search_norm)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'verified', ?, ?, ?)`
  ).run(
    d.externalId, d.brandName || null, d.genericName || null, d.warnings || null, d.foodEffect || null,
    d.source, d.sourceUrl || null, timestamp, timestamp, searchNorm
  );
  return 'inserted';
}

export function upsertResearch(r) {
  const db = getDb();
  const timestamp = now();
  const searchNorm = normalizeVi([r.title, r.abstract, r.authors, r.journal].filter(Boolean).join(' '));
  const existing = getOne('SELECT id FROM research_articles WHERE external_id = ? AND source = ?', [r.externalId, r.source]);
  if (existing) {
    db.prepare(
      `UPDATE research_articles SET title = ?, abstract = COALESCE(?, abstract), authors = COALESCE(?, authors),
         journal = COALESCE(?, journal), pub_date = COALESCE(?, pub_date), source_url = COALESCE(?, source_url),
         updated_at = ?, search_norm = ? WHERE id = ?`
    ).run(r.title, r.abstract || null, r.authors || null, r.journal || null, r.pubDate || null,
      r.sourceUrl || null, timestamp, searchNorm, existing.id);
    return 'updated';
  }
  db.prepare(
    `INSERT INTO research_articles (external_id, title, abstract, authors, journal, pub_date, source,
       source_url, verification_status, created_at, updated_at, search_norm)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'verified', ?, ?, ?)`
  ).run(r.externalId, r.title, r.abstract || null, r.authors || null, r.journal || null, r.pubDate || null,
    r.source, r.sourceUrl || null, timestamp, timestamp, searchNorm);
  return 'inserted';
}

export function upsertFoodItem(f) {
  const db = getDb();
  const timestamp = now();
  const searchNorm = normalizeVi([f.description, f.brandOwner, f.dataType].filter(Boolean).join(' '));
  const existing = getOne('SELECT id FROM foods WHERE external_id = ? AND source = ?', [f.externalId, f.source]);
  if (existing) {
    db.prepare(
      `UPDATE foods SET description = ?, data_type = ?, brand_owner = ?, nutrients_json = ?,
         source_url = ?, updated_at = ?, search_norm = ? WHERE id = ?`
    ).run(f.description, f.dataType || null, f.brandOwner || null, f.nutrientsJson || null,
      f.sourceUrl || null, timestamp, searchNorm, existing.id);
    return 'updated';
  }
  db.prepare(
    `INSERT INTO foods (external_id, description, data_type, brand_owner, nutrients_json, source,
       source_url, verification_status, created_at, updated_at, search_norm)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'verified', ?, ?, ?)`
  ).run(f.externalId, f.description, f.dataType || null, f.brandOwner || null, f.nutrientsJson || null,
    f.source, f.sourceUrl || null, timestamp, timestamp, searchNorm);
  return 'inserted';
}
