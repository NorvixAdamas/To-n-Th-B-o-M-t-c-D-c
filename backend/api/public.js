import express from 'express';
import { config } from '../config/config.js';
import { getAll, getOne, run } from '../database/db.js';
import { asyncHandler, HttpError, intParam, stringParam } from '../middleware/http.js';
import { searchAll, SEARCH_TYPES, DOMAIN_LABELS } from '../services/search.js';
import { getPublicStats } from '../services/stats.js';
import { lookupCve, recentSyncLogs } from '../services/sync.js';
import { requireAuth, requireCsrf } from '../middleware/http.js';
import { normalizeVi } from '../utils/text.js';
import { renderMarkdown } from '../utils/markdown.js';

const router = express.Router();

router.use((req, res, next) => {
  if (!config.requireLoginForContent) return next();
  if (req.session) return next();
  return res.status(401).json({ error: { code: 'login_required', message: 'Cần đăng nhập để đọc nội dung.' } });
});

router.get('/health', (req, res) => {
  const db = getOne('SELECT 1 AS ok');
  res.json({
    status: db?.ok === 1 ? 'ok' : 'degraded',
    version: '2.0.0',
    uptimeSeconds: Math.round(process.uptime()),
    time: new Date().toISOString()
  });
});

router.get('/meta', (req, res) => {
  const settings = Object.fromEntries(
    getAll('SELECT setting_key, value FROM site_settings').map((row) => [row.setting_key, row.value])
  );
  res.json({
    site: {
      title: settings.site_title,
      description: settings.site_description,
      version: settings.site_version || '2.0.0'
    },
    domains: Object.entries(DOMAIN_LABELS).map(([key, label]) => ({ key, label })),
    types: Object.entries(SEARCH_TYPES).map(([key, meta]) => ({ key, ...meta })),
    glossaryCount: Number(getOne('SELECT COUNT(*) AS n FROM glossary_terms').n)
  });
});

router.get('/stats', (req, res) => {
  res.json({ stats: getPublicStats(), generatedAt: new Date().toISOString() });
});

router.get('/search', (req, res) => {
  const payload = searchAll({
    q: stringParam(req.query.q, 200),
    type: stringParam(req.query.type, 30),
    domain: stringParam(req.query.domain, 40),
    source: stringParam(req.query.source, 100),
    from: stringParam(req.query.from, 10),
    to: stringParam(req.query.to, 10),
    sort: stringParam(req.query.sort, 20),
    page: intParam(req.query.page, 1, { min: 1, max: 10000 }),
    limit: intParam(req.query.limit, 12, { min: 1, max: 50 })
  });
  res.json(payload);
});

router.get('/glossary', (req, res) => {
  const q = stringParam(req.query.q, 100);
  const domain = stringParam(req.query.domain, 40);
  const limit = intParam(req.query.limit, 500, { min: 1, max: 500 });
  const norm = normalizeVi(q);
  const params = [];
  let where = '1=1';
  if (norm) {
    where += ' AND search_norm LIKE ?';
    params.push(`%${norm}%`);
  }
  if (domain) {
    where += ' AND domain = ?';
    params.push(domain);
  }
  const total = Number(getOne(`SELECT COUNT(*) AS n FROM glossary_terms WHERE ${where}`, params).n);
  const terms = getAll(
    `SELECT id, term, definition, domain, source_url, verification_status, updated_at
     FROM glossary_terms WHERE ${where} ORDER BY domain, term LIMIT ?`,
    [...params, limit]
  );
  res.json({ total, terms });
});

router.get('/chemicals', (req, res) => {
  const q = stringParam(req.query.q, 100);
  const category = stringParam(req.query.category, 40);
  const limit = intParam(req.query.limit, 30, { min: 1, max: 100 });
  const offset = intParam(req.query.offset, 0, { min: 0, max: 10000 });
  const params = [];
  let where = '1=1';
  if (q) {
    where += ' AND search_norm LIKE ?';
    params.push(`%${normalizeVi(q)}%`);
  }
  if (category) {
    where += ' AND category = ?';
    params.push(category);
  }
  const total = Number(getOne(`SELECT COUNT(*) AS n FROM chemicals WHERE ${where}`, params).n);
  const rows = getAll(
    `SELECT id, name, common_names, cas_number, molecular_formula, molecular_weight, category, description,
            source_url, verification_status, updated_at
     FROM chemicals WHERE ${where} ORDER BY name LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ total, chemicals: rows });
});

router.get('/chemicals/:id', (req, res, next) => {
  try {
    const raw = String(req.params.id || '').trim();
    let row = null;
    if (/^\d+$/.test(raw)) {
      row = getOne('SELECT * FROM chemicals WHERE id = ?', [Number(raw)]);
    } else {
      row = getOne('SELECT * FROM chemicals WHERE cas_number = ?', [raw])
        || getOne('SELECT * FROM chemicals WHERE name = ? COLLATE NOCASE', [raw])
        || getOne('SELECT * FROM chemicals WHERE name LIKE ? COLLATE NOCASE ORDER BY name LIMIT 1', [`%${raw}%`])
        || getOne('SELECT * FROM chemicals WHERE common_names LIKE ? COLLATE NOCASE ORDER BY name LIMIT 1', [`%${raw}%`])
        || getOne('SELECT * FROM chemicals WHERE iupac_name LIKE ? COLLATE NOCASE ORDER BY name LIMIT 1', [`%${raw}%`]);
    }
    if (!row) throw new HttpError(404, 'not_found', 'Không tìm thấy hồ sơ hóa chất.');
    let sources = [];
    try {
      sources = JSON.parse(row.sources_json || '[]');
    } catch {
      sources = [];
    }
    res.json({ chemical: { ...row, sources } });
  } catch (error) {
    next(error);
  }
});

router.get('/vulnerabilities/:cve', asyncHandler(async (req, res) => {
  const result = await lookupCve(req.params.cve);
  if (!result?.row) throw new HttpError(404, 'not_found', 'Không tìm thấy CVE trong CSDL hoặc NVD.');
  res.json({ vulnerability: result.row, cached: result.cached });
}));

router.get('/articles/:slug', (req, res, next) => {
  try {
    const row = getOne(
      `SELECT id, slug, title, summary, body, domain, path, content_type, status, source_url,
              verification_status, published_at, updated_at
       FROM articles WHERE slug = ? AND status = 'published'`,
      [stringParam(req.params.slug, 120)]
    );
    if (!row) throw new HttpError(404, 'not_found', 'Không tìm thấy bài viết.');
    res.json({
      article: { ...row, html: row.content_type === 'editorial' ? renderMarkdown(row.body) : null },
      legacy: row.content_type === 'legacy',
      url: row.path ? (row.path.startsWith('/') ? row.path : `/${row.path}`) : null
    });
  } catch (error) {
    next(error);
  }
});

router.get('/sources', (req, res) => {
  const rows = getAll(
    `SELECT source_key, number, name, organization, category, url, api_endpoint, access_type,
            requires_key, env_var, license, notes, connector, status, last_sync_at, last_error, record_count
     FROM external_sources ORDER BY number`
  );
  res.json({
    total: rows.length,
    integrated: rows.filter((r) => r.connector).length,
    sources: rows
  });
});

router.get('/sources/logs', (req, res) => {
  res.json({ logs: recentSyncLogs(20) });
});

router.get('/research', (req, res) => {
  const q = stringParam(req.query.q, 100);
  const params = [];
  let where = '1=1';
  if (q) {
    where += ' AND search_norm LIKE ?';
    params.push(`%${normalizeVi(q)}%`);
  }
  const rows = getAll(
    `SELECT id, external_id, title, authors, journal, pub_date, source_url
     FROM research_articles WHERE ${where} ORDER BY updated_at DESC LIMIT 30`,
    params
  );
  res.json({ research: rows });
});

// ---------------------------------------------------------------------------
// Bookmark — yêu cầu đăng nhập, không dùng sessionStorage làm bằng chứng quyền.
// ---------------------------------------------------------------------------
router.get('/bookmarks', requireAuth, (req, res) => {
  const rows = getAll('SELECT * FROM bookmarks WHERE user_id = ? ORDER BY created_at DESC', [req.session.user.id]);
  res.json({ bookmarks: rows });
});

router.post('/bookmarks', requireAuth, requireCsrf, (req, res, next) => {
  try {
    const entityType = stringParam(req.body?.entityType, 30);
    const entityId = stringParam(req.body?.entityId, 200);
    const title = stringParam(req.body?.title, 300);
    if (!Object.prototype.hasOwnProperty.call(SEARCH_TYPES, entityType) || !entityId) {
      throw new HttpError(400, 'invalid_input', 'Loại hoặc mã đối tượng không hợp lệ.');
    }
    run(
      `INSERT INTO bookmarks (user_id, entity_type, entity_id, title, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, entity_type, entity_id) DO UPDATE SET title = excluded.title`,
      [req.session.user.id, entityType, entityId, title, new Date().toISOString()]
    );
    res.status(201).json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.delete('/bookmarks/:id', requireAuth, requireCsrf, (req, res, next) => {
  try {
    const id = intParam(req.params.id, 0, { min: 0, max: 1e9 });
    run('DELETE FROM bookmarks WHERE id = ? AND user_id = ?', [id, req.session.user.id]);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export default router;
