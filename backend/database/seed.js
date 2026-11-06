import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from '../config/config.js';
import { getDb, transaction, setSetting } from './db.js';
import { normalizeVi, stripHtml } from '../utils/text.js';
import { readLegacyGlossary } from './legacy-import.js';

const now = () => new Date().toISOString();

function readSeed(name) {
  return JSON.parse(fs.readFileSync(path.join(config.root, 'data', 'seed', name), 'utf8'));
}

const CATEGORIES = [
  ['cyber-defense', 'Phòng thủ & ứng phó', 'cybersecurity', 'Phòng thủ hệ thống, ứng phó sự cố, quản lý lỗ hổng.'],
  ['incident-response', 'Ứng phó sự cố', 'cybersecurity', 'Quy trình xử lý sự cố an ninh mạng.'],
  ['threat-intelligence', 'Tình báo mối đe dọa', 'cybersecurity', 'Chiến thuật, kỹ thuật và chỉ báo tấn công.'],
  ['toxicology', 'Độc học', 'toxicology', 'Cơ chế độc tính, độc tố và thuốc giải.'],
  ['food-safety', 'An toàn thực phẩm', 'food-safety', 'Mối nguy sinh học, hóa học và thu hồi thực phẩm.'],
  ['forensic', 'Khoa học pháp y', 'forensic', 'Điều tra, chứng cứ và độc học pháp y.'],
  ['weapons', 'Vũ khí & đồ cấm', 'weapons', 'Nhận diện, pháp lý và an toàn hiện trường.'],
  ['chemical-safety', 'An toàn hóa chất', 'safety', 'Bảo quản, phòng ngừa và ứng phó hóa chất.'],
  ['first-aid', 'Sơ cấp cứu', 'safety', 'Kỹ năng sơ cứu cộng đồng.'],
  ['legal', 'Pháp luật', 'legal', 'Văn bản và quy định tham chiếu.']
];

const LEGACY_ARTICLES = [
  ['cybersecurity', 'An ninh mạng — Cybersecurity Lab', 'Lịch sử xâm nhập, case study, pentest đạo đức, OWASP Top 10, vụ án khó, mật mã, phòng thủ nhiều lớp và ứng phó sự cố.', 'cybersecurity', 'cyber-defense'],
  ['toxicology', 'Độc học & An toàn thực phẩm', 'Độc tính học, tương tác thuốc–thực phẩm, độc tố tự nhiên, hóa chất gia dụng, khí độc, sơ cứu, thuốc giải và độc học pháp y.', 'toxicology', 'toxicology'],
  ['weapons', 'Chống vũ khí và đồ bất hợp pháp', 'Khung pháp lý, phân loại và nhận diện vũ khí, vật liệu nổ, vũ khí tự chế; bảo quản chứng cứ và an toàn hiện trường.', 'weapons', 'weapons'],
  ['safety', 'An toàn đời sống & Sơ cấp cứu', 'Phòng cháy chữa cháy, an toàn lao động và hóa chất, sơ cấp cứu, an toàn thực phẩm, bảo vệ trẻ em và hiểm họa theo mùa.', 'safety', 'first-aid']
];

const PERMISSIONS = [
  ['content.read', 'Đọc nội dung quản trị'],
  ['content.write', 'Thêm/sửa bài viết'],
  ['content.delete', 'Xóa bài viết'],
  ['glossary.manage', 'Quản lý thuật ngữ'],
  ['chemicals.manage', 'Quản lý hồ sơ hóa chất'],
  ['sources.manage', 'Bật/tắt nguồn dữ liệu'],
  ['sync.run', 'Chạy đồng bộ nguồn dữ liệu'],
  ['users.manage', 'Quản lý người dùng'],
  ['audit.read', 'Xem nhật ký hoạt động'],
  ['backup.run', 'Sao lưu và khôi phục'],
  ['settings.manage', 'Quản lý cấu hình website']
];

const ROLE_PERMISSIONS = {
  admin: PERMISSIONS.map((p) => p[0]),
  editor: ['content.read', 'content.write', 'glossary.manage', 'chemicals.manage', 'sources.manage', 'sync.run'],
  viewer: ['content.read']
};

export function seedDatabase({ quiet = false } = {}) {
  const db = getDb();
  const report = {};
  const timestamp = now();

  transaction(() => {
    // ----- Vai trò & quyền -----
    const roleStmt = db.prepare('INSERT OR IGNORE INTO roles (name, description) VALUES (?, ?)');
    roleStmt.run('admin', 'Quản trị viên toàn hệ thống');
    roleStmt.run('editor', 'Biên tập nội dung và dữ liệu');
    roleStmt.run('viewer', 'Chỉ đọc nội dung quản trị');

    const permStmt = db.prepare('INSERT OR IGNORE INTO permissions (code, description) VALUES (?, ?)');
    for (const [code, description] of PERMISSIONS) permStmt.run(code, description);

    const roles = new Map(db.prepare('SELECT id, name FROM roles').all().map((r) => [r.name, r.id]));
    const perms = new Map(db.prepare('SELECT id, code FROM permissions').all().map((p) => [p.code, p.id]));
    const linkStmt = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)');
    for (const [role, codes] of Object.entries(ROLE_PERMISSIONS)) {
      for (const code of codes) linkStmt.run(roles.get(role), perms.get(code));
    }

    // ----- Danh mục -----
    const catStmt = db.prepare(
      `INSERT INTO categories (slug, name, domain, description, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(slug) DO UPDATE SET name = excluded.name, domain = excluded.domain, description = excluded.description`
    );
    for (const [slug, name, domain, description] of CATEGORIES) catStmt.run(slug, name, domain, description, timestamp);
    const categories = new Map(db.prepare('SELECT id, slug FROM categories').all().map((c) => [c.slug, c.id]));

    // ----- Bài viết -----
    const articleStmt = db.prepare(
      `INSERT INTO articles (slug, title, summary, body, domain, category_id, path, content_type, status,
         source_url, verification_status, data_origin, license, version, published_at, created_at, updated_at, search_norm)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, 'editorial', 'Nội bộ biên soạn', 1, ?, ?, ?, ?)
       ON CONFLICT(slug) DO UPDATE SET
         title = excluded.title,
         summary = excluded.summary,
         body = CASE WHEN articles.locked = 1 THEN articles.body ELSE excluded.body END,
         domain = excluded.domain,
         category_id = excluded.category_id,
         path = excluded.path,
         source_url = excluded.source_url,
         verification_status = excluded.verification_status,
         updated_at = excluded.updated_at,
         search_norm = excluded.search_norm`
    );

    for (const [slug, title, summary, domain, category] of LEGACY_ARTICLES) {
      articleStmt.run(
        slug, title, summary, '', domain, categories.get(category) || null,
        `${slug}.html`, 'legacy', null, 'editorial',
        '2025-08-15T00:00:00.000Z', timestamp, timestamp,
        normalizeVi(`${title} ${summary} ${slug}`)
      );
    }

    const seededArticles = readSeed('articles.json');
    for (const article of seededArticles) {
      articleStmt.run(
        article.slug, article.title, article.summary, article.body, article.domain,
        categories.get(article.category) || null, `/article.html?slug=${encodeURIComponent(article.slug)}`,
        'editorial', article.source_url || null, article.verification_status || 'editorial',
        timestamp, timestamp, timestamp,
        normalizeVi(`${article.title} ${article.summary} ${stripHtml(article.body)}`)
      );
    }

    // ----- Thuật ngữ từ phiên bản 1.0 -----
    const glossary = readLegacyGlossary();
    if (glossary.length < 295) {
      throw new Error(`Nhập thuật ngữ thất bại: chỉ đọc được ${glossary.length}/295 mục từ glossary.html`);
    }
    const termStmt = db.prepare(
      `INSERT INTO glossary_terms (term, definition, domain, verification_status, data_origin, license,
         version, legacy_index, created_at, updated_at, search_norm)
       VALUES (?, ?, ?, 'editorial', 'legacy-v1', 'Nội bộ biên soạn', 1, ?, ?, ?, ?)
       ON CONFLICT(term, domain) DO UPDATE SET
         definition = CASE WHEN glossary_terms.locked = 1 THEN glossary_terms.definition ELSE excluded.definition END,
         legacy_index = excluded.legacy_index,
         updated_at = excluded.updated_at,
         search_norm = excluded.search_norm`
    );
    for (const term of glossary) {
      termStmt.run(term.term, term.definition, term.domain, term.legacyIndex, timestamp, timestamp, term.searchNorm);
    }
    report.glossary = glossary.length;

    // ----- Hóa chất -----
    const chemicals = [...readSeed('chemicals-1.json'), ...readSeed('chemicals-2.json')];
    const findChemical = db.prepare('SELECT id, locked FROM chemicals WHERE name = ? OR (cas_number IS NOT NULL AND cas_number = ?)');
    const insertChemical = db.prepare(
      `INSERT INTO chemicals (name, common_names, cas_number, molecular_formula, iupac_name, category, description,
         hazards, exposure_routes, health_effects, prevention, response, source_url, sources_json, pubchem_cid,
         verification_status, data_origin, license, version, created_at, updated_at, search_norm)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'curated', 'editorial', 'Nội bộ biên soạn', 1, ?, ?, ?)`
    );
    const updateChemical = db.prepare(
      `UPDATE chemicals SET common_names = ?, cas_number = ?, molecular_formula = ?, category = ?, description = ?,
         hazards = ?, exposure_routes = ?, health_effects = ?, prevention = ?, response = ?, source_url = ?,
         sources_json = ?, pubchem_cid = ?, updated_at = ?, search_norm = ? WHERE id = ?`
    );

    for (const chem of chemicals) {
      const searchNorm = normalizeVi([
        chem.name, chem.aliases, chem.cas, chem.formula, chem.category, chem.description,
        chem.hazards, chem.exposure, chem.health, chem.prevention, chem.response
      ].join(' '));
      const existing = findChemical.get(chem.name, chem.cas || '__none__');
      if (!existing) {
        insertChemical.run(
          chem.name, chem.aliases, chem.cas, chem.formula, chem.category, chem.description, chem.hazards,
          chem.exposure, chem.health, chem.prevention, chem.response,
          (chem.sources && chem.sources[0]) || null, JSON.stringify(chem.sources || []), chem.cid || null,
          timestamp, timestamp, searchNorm
        );
      } else if (!existing.locked) {
        updateChemical.run(
          chem.aliases, chem.cas, chem.formula, chem.category, chem.description, chem.hazards, chem.exposure,
          chem.health, chem.prevention, chem.response, (chem.sources && chem.sources[0]) || null,
          JSON.stringify(chem.sources || []), chem.cid || null, timestamp, searchNorm, existing.id
        );
      }
    }
    report.chemicals = chemicals.length;

    // ----- Lỗ hổng mẫu -----
    const vulnStmt = db.prepare(
      `INSERT INTO vulnerabilities (cve_id, title, description, cvss_score, cvss_severity, cvss_vector, cwe_ids,
         affected_products, remediation, known_exploited, published_at, modified_at, source_url, data_origin,
         verification_status, license, created_at, updated_at, search_norm)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'nvd', 'verified', 'Dữ liệu công khai NVD', ?, ?, ?)
       ON CONFLICT(cve_id) DO UPDATE SET
         title = excluded.title, description = excluded.description, cvss_score = excluded.cvss_score,
         cvss_severity = excluded.cvss_severity, cvss_vector = excluded.cvss_vector, cwe_ids = excluded.cwe_ids,
         affected_products = excluded.affected_products, remediation = excluded.remediation,
         known_exploited = MAX(vulnerabilities.known_exploited, excluded.known_exploited),
         published_at = excluded.published_at, source_url = excluded.source_url,
         updated_at = excluded.updated_at, search_norm = excluded.search_norm
       WHERE vulnerabilities.locked = 0`
    );
    for (const vuln of readSeed('vulnerabilities.json')) {
      vulnStmt.run(
        vuln.cve, vuln.title, vuln.description, vuln.score, vuln.severity, vuln.vector, vuln.cwe,
        vuln.affected, vuln.remediation, vuln.kev ? 1 : 0, vuln.published, vuln.published, vuln.url,
        timestamp, timestamp,
        normalizeVi(`${vuln.cve} ${vuln.title} ${vuln.description} ${vuln.cwe} ${vuln.affected}`)
      );
    }
    report.vulnerabilities = readSeed('vulnerabilities.json').length;

    // ----- ATT&CK -----
    const threatStmt = db.prepare(
      `INSERT INTO threat_intel (external_id, kind, name, description, tactic, technique_id, source, source_url,
         data_origin, verification_status, license, created_at, updated_at, search_norm)
       VALUES (?, 'technique', ?, ?, ?, ?, 'mitre-attack', ?, 'mitre-attack', 'reference', 'MITRE ATT&CK Terms of Use', ?, ?, ?)
       ON CONFLICT(external_id, source) DO UPDATE SET name = excluded.name, description = excluded.description,
         tactic = excluded.tactic, technique_id = excluded.technique_id, updated_at = excluded.updated_at,
         search_norm = excluded.search_norm`
    );
    for (const technique of readSeed('threat-intel.json')) {
      threatStmt.run(
        technique.id, technique.name, technique.description, technique.tactic, technique.id, technique.url,
        timestamp, timestamp, normalizeVi(`${technique.id} ${technique.name} ${technique.description} ${technique.tactic}`)
      );
    }

    // ----- Văn bản pháp luật -----
    const legal = readSeed('legal.json');
    const findLegal = db.prepare('SELECT id FROM legal_documents WHERE document_number = ?');
    const insertLegal = db.prepare(
      `INSERT INTO legal_documents (document_number, title, issuer, issued_year, domain, summary, source_url,
         verification_status, created_at, updated_at, search_norm)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'reference', ?, ?, ?)`
    );
    for (const doc of legal) {
      if (!findLegal.get(doc.number)) {
        insertLegal.run(
          doc.number, doc.title, doc.issuer, doc.year, doc.domain, doc.summary, doc.url,
          timestamp, timestamp, normalizeVi(`${doc.number} ${doc.title} ${doc.issuer} ${doc.summary}`)
        );
      }
    }

    // ----- Quy trình an toàn -----
    const protocolStmt = db.prepare(
      `INSERT INTO safety_protocols (slug, title, summary, steps_json, audience, source_url, verification_status,
         created_at, updated_at, search_norm)
       VALUES (?, ?, ?, ?, ?, ?, 'reference', ?, ?, ?)
       ON CONFLICT(slug) DO UPDATE SET title = excluded.title, summary = excluded.summary,
         steps_json = excluded.steps_json, audience = excluded.audience, source_url = excluded.source_url,
         updated_at = excluded.updated_at, search_norm = excluded.search_norm`
    );
    for (const protocol of readSeed('protocols.json')) {
      protocolStmt.run(
        protocol.slug, protocol.title, protocol.summary, JSON.stringify(protocol.steps), protocol.audience,
        protocol.source, timestamp, timestamp,
        normalizeVi(`${protocol.title} ${protocol.summary} ${protocol.steps.join(' ')} ${protocol.audience}`)
      );
    }

    // ----- Nhận diện vũ khí & case study -----
    const { weapons, cases } = readSeed('weapons-cases.json');
    const findWeapon = db.prepare('SELECT id FROM weapons_reference WHERE name = ?');
    const insertWeapon = db.prepare(
      `INSERT INTO weapons_reference (name, category, recognition_markers, legal_note, handling_note, source_url,
         verification_status, created_at, updated_at, search_norm)
       VALUES (?, ?, ?, ?, ?, ?, 'reference', ?, ?, ?)`
    );
    for (const weapon of weapons) {
      if (!findWeapon.get(weapon.name)) {
        insertWeapon.run(
          weapon.name, weapon.category, weapon.markers, weapon.legal, weapon.handling, weapon.url,
          timestamp, timestamp, normalizeVi(`${weapon.name} ${weapon.category} ${weapon.markers} ${weapon.legal}`)
        );
      }
    }

    const findCase = db.prepare('SELECT id FROM forensic_cases WHERE title = ?');
    const insertCase = db.prepare(
      `INSERT INTO forensic_cases (title, summary, year, domain, findings, source_url, verification_status,
         created_at, updated_at, search_norm)
       VALUES (?, ?, ?, ?, ?, ?, 'reference', ?, ?, ?)`
    );
    for (const item of cases) {
      if (!findCase.get(item.title)) {
        insertCase.run(
          item.title, item.summary, item.year, item.domain, item.findings, item.url,
          timestamp, timestamp, normalizeVi(`${item.title} ${item.summary} ${item.findings}`)
        );
      }
    }

    // ----- Nguồn dữ liệu (giữ nguyên trạng thái đồng bộ đã có) -----
    const sourceStmt = db.prepare(
      `INSERT INTO external_sources (source_key, number, name, organization, category, url, api_endpoint,
         access_type, requires_key, env_var, license, notes, enabled, connector, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'never', ?, ?)
       ON CONFLICT(source_key) DO UPDATE SET number = excluded.number, name = excluded.name,
         organization = excluded.organization, category = excluded.category, url = excluded.url,
         api_endpoint = excluded.api_endpoint, access_type = excluded.access_type,
         requires_key = excluded.requires_key, env_var = excluded.env_var, license = excluded.license,
         notes = excluded.notes, connector = excluded.connector, updated_at = excluded.updated_at`
    );
    const sources = readSeed('sources.json');
    for (const source of sources) {
      sourceStmt.run(
        source.key, source.number, source.name, source.organization, source.category, source.url,
        source.api || null, source.access, source.keyEnv ? 1 : 0, source.keyEnv || null,
        source.license || null, source.notes || null, source.connector || null, timestamp, timestamp
      );
    }
    report.sources = sources.length;

    // ----- Cấu hình -----
    const defaults = {
      site_title: 'Bách Khoa Toàn Thư về Bảo Mật và Khoa Học Độc Học',
      site_description: 'Thư viện tri thức đa ngành về an ninh mạng, độc học, an toàn thực phẩm, pháp y và an toàn đời sống.',
      site_version: '2.0.0',
      schema_version: '2',
      last_seed_at: timestamp
    };
    for (const [key, value] of Object.entries(defaults)) setSetting(key, value);
  });

  report.articles = 4 + seededArticlesCount();
  report.protocols = readSeed('protocols.json').length;
  report.legal = readSeed('legal.json').length;
  if (!quiet) {
    console.log('Đã nạp dữ liệu:', report);
  }
  return report;
}

function seededArticlesCount() {
  try {
    return readSeed('articles.json').length;
  } catch {
    return 0;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = seedDatabase();
  console.log('Hoàn tất seed. Tổng thuật ngữ:', report.glossary);
}
