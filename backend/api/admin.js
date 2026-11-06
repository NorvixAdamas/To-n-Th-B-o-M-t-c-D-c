import express from 'express';
import { getDb, getOne, getAll, run } from '../database/db.js';
import { asyncHandler, HttpError, intParam, requireAuth, requirePermission, requireCsrf, stringParam } from '../middleware/http.js';
import { getAdminOverview } from '../services/stats.js';
import { createBackup, listBackups, dbInfo, listAudit, recordAudit } from '../services/admin.js';
import { startSyncJob, getSyncJob, recentSyncLogs, syncableSources } from '../services/sync.js';
import { hashPassword, validatePasswordStrength, revokeUserSessions, getPermissions } from '../auth/security.js';
import { normalizeVi, stripHtml, slugify } from '../utils/text.js';
import { DOMAIN_LABELS } from '../services/search.js';

const router = express.Router();
const now = () => new Date().toISOString();

router.use(requireAuth);

// Bắt buộc đổi mật khẩu tạm trước khi dùng bất kỳ API quản trị nào.
router.use((req, res, next) => {
  if (req.session.user.mustChangePassword) {
    return res.status(403).json({
      error: {
        code: 'password_change_required',
        message: 'Bạn phải đổi mật khẩu tạm trước khi tiếp tục sử dụng khu vực quản trị.'
      }
    });
  }
  next();
});

// ---------------------------------------------------------------------------
// Tổng quan
// ---------------------------------------------------------------------------
router.get('/overview', requirePermission('content.read'), (req, res) => {
  res.json({ overview: getAdminOverview(), db: dbInfo(), backups: listBackups().slice(0, 5) });
});

// ---------------------------------------------------------------------------
// Bài viết
// ---------------------------------------------------------------------------
function articleSearchNorm(title, summary, body) {
  return normalizeVi(`${title} ${summary} ${stripHtml(body)}`);
}

router.get('/articles', requirePermission('content.read'), (req, res) => {
  const q = stringParam(req.query.q, 100);
  const status = ['published', 'draft', 'archived'].includes(req.query.status) ? req.query.status : '';
  const params = [];
  let where = '1=1';
  if (q) {
    where += ' AND search_norm LIKE ?';
    params.push(`%${normalizeVi(q)}%`);
  }
  if (status) {
    where += ' AND status = ?';
    params.push(status);
  }
  const rows = getAll(
    `SELECT id, slug, title, summary, domain, path, content_type, status, source_url, verification_status,
            version, locked, published_at, updated_at
     FROM articles WHERE ${where} ORDER BY updated_at DESC LIMIT 100`, params
  );
  res.json({ articles: rows });
});

router.get('/articles/:id', requirePermission('content.read'), (req, res, next) => {
  try {
    const id = intParam(req.params.id, 0, { min: 1, max: 1e9 });
    const article = getOne('SELECT * FROM articles WHERE id = ?', [id]);
    if (!article) throw new HttpError(404, 'not_found', 'Không tìm thấy bài viết.');
    res.json({ article });
  } catch (error) {
    next(error);
  }
});

router.post('/articles', requirePermission('content.write'), (req, res, next) => {
  try {
    const title = stringParam(req.body?.title, 240).trim();
    const domain = stringParam(req.body?.domain, 40);
    const summary = stringParam(req.body?.summary, 600).trim();
    const body = String(req.body?.body || '').slice(0, 60000);
    const status = ['published', 'draft'].includes(req.body?.status) ? req.body.status : 'draft';
    if (title.length < 4) throw new HttpError(400, 'invalid_input', 'Tiêu đề quá ngắn.');
    if (!DOMAIN_LABELS[domain]) throw new HttpError(400, 'invalid_domain', 'Lĩnh vực không hợp lệ.');
    let slug = slugify(req.body?.slug || title);
    if (getOne('SELECT id FROM articles WHERE slug = ?', [slug])) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
    const timestamp = now();
    const result = run(
      `INSERT INTO articles (slug, title, summary, body, domain, path, content_type, status, source_url,
         verification_status, data_origin, license, version, created_by, updated_by, published_at,
         created_at, updated_at, search_norm)
       VALUES (?, ?, ?, ?, ?, ?, 'editorial', ?, ?, 'editorial', 'editorial', 'Nội bộ biên soạn', 1, ?, ?, ?, ?, ?, ?)`,
      [slug, title, summary, body, domain, `/article.html?slug=${encodeURIComponent(slug)}`, status,
        stringParam(req.body?.sourceUrl, 500) || null, req.session.user.id, req.session.user.id,
        status === 'published' ? timestamp : null, timestamp, timestamp, articleSearchNorm(title, summary, body)]
    );
    recordAudit(req, 'article_created', { entityType: 'article', entityId: result.lastInsertRowid, details: { title } });
    res.status(201).json({ id: Number(result.lastInsertRowid), slug });
  } catch (error) {
    next(error);
  }
});

router.patch('/articles/:id', requirePermission('content.write'), (req, res, next) => {
  try {
    const id = intParam(req.params.id, 0, { min: 1, max: 1e9 });
    const article = getOne('SELECT * FROM articles WHERE id = ?', [id]);
    if (!article) throw new HttpError(404, 'not_found', 'Không tìm thấy bài viết.');
    const title = req.body?.title !== undefined ? stringParam(req.body.title, 240).trim() : article.title;
    const summary = req.body?.summary !== undefined ? stringParam(req.body.summary, 600).trim() : article.summary;
    let body = article.body;
    if (req.body?.body !== undefined && article.content_type === 'editorial') {
      body = String(req.body.body).slice(0, 60000);
    }
    const domain = req.body?.domain !== undefined ? stringParam(req.body.domain, 40) : article.domain;
    if (!DOMAIN_LABELS[domain]) throw new HttpError(400, 'invalid_domain', 'Lĩnh vực không hợp lệ.');
    const status = ['published', 'draft', 'archived'].includes(req.body?.status) ? req.body.status : article.status;
    const timestamp = now();
    run(
      `UPDATE articles SET title = ?, summary = ?, body = ?, domain = ?, status = ?, source_url = ?,
         version = version + 1, locked = 1, updated_by = ?, published_at = COALESCE(?, published_at),
         updated_at = ?, search_norm = ? WHERE id = ?`,
      [title, summary, body, domain, status, req.body?.sourceUrl !== undefined
        ? stringParam(req.body.sourceUrl, 500) || null : article.source_url,
      req.session.user.id, status === 'published' ? timestamp : null, timestamp,
      articleSearchNorm(title, summary, body), id]
    );
    recordAudit(req, 'article_updated', { entityType: 'article', entityId: id, details: { title } });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.delete('/articles/:id', requirePermission('content.delete'), (req, res, next) => {
  try {
    const id = intParam(req.params.id, 0, { min: 1, max: 1e9 });
    const article = getOne('SELECT title FROM articles WHERE id = ?', [id]);
    if (!article) throw new HttpError(404, 'not_found', 'Không tìm thấy bài viết.');
    run('DELETE FROM articles WHERE id = ?', [id]);
    recordAudit(req, 'article_deleted', { entityType: 'article', entityId: id, details: { title: article.title } });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Thuật ngữ
// ---------------------------------------------------------------------------
router.get('/glossary', requirePermission('content.read'), (req, res) => {
  const q = stringParam(req.query.q, 100);
  const rows = getAll(
    `SELECT id, term, definition, domain, source_url, version, locked, updated_at
     FROM glossary_terms ${q ? 'WHERE search_norm LIKE ?' : ''} ORDER BY domain, term LIMIT 500`,
    q ? [`%${normalizeVi(q)}%`] : []
  );
  res.json({ glossary: rows });
});

router.post('/glossary', requirePermission('glossary.manage'), (req, res, next) => {
  try {
    const term = stringParam(req.body?.term, 200).trim();
    const definition = stringParam(req.body?.definition, 3000).trim();
    const domain = stringParam(req.body?.domain, 40);
    if (!term || definition.length < 5) throw new HttpError(400, 'invalid_input', 'Thuật ngữ hoặc định nghĩa không hợp lệ.');
    if (!DOMAIN_LABELS[domain]) throw new HttpError(400, 'invalid_domain', 'Lĩnh vực không hợp lệ.');
    if (getOne('SELECT id FROM glossary_terms WHERE term = ? AND domain = ?', [term, domain])) {
      throw new HttpError(409, 'duplicate', 'Thuật ngữ đã tồn tại trong lĩnh vực này.');
    }
    const timestamp = now();
    const result = run(
      `INSERT INTO glossary_terms (term, definition, domain, source_url, verification_status, data_origin,
         license, version, locked, created_at, updated_at, search_norm)
       VALUES (?, ?, ?, ?, 'editorial', 'admin', 'Nội bộ biên soạn', 1, 1, ?, ?, ?)`,
      [term, definition, domain, stringParam(req.body?.sourceUrl, 500) || null, timestamp, timestamp,
        normalizeVi(`${term} ${definition}`)]
    );
    recordAudit(req, 'glossary_created', { entityType: 'glossary', entityId: result.lastInsertRowid, details: { term } });
    res.status(201).json({ id: Number(result.lastInsertRowid) });
  } catch (error) {
    next(error);
  }
});

router.patch('/glossary/:id', requirePermission('glossary.manage'), (req, res, next) => {
  try {
    const id = intParam(req.params.id, 0, { min: 1, max: 1e9 });
    const row = getOne('SELECT * FROM glossary_terms WHERE id = ?', [id]);
    if (!row) throw new HttpError(404, 'not_found', 'Không tìm thấy thuật ngữ.');
    const term = req.body?.term !== undefined ? stringParam(req.body.term, 200).trim() : row.term;
    const definition = req.body?.definition !== undefined ? stringParam(req.body.definition, 3000).trim() : row.definition;
    const domain = req.body?.domain !== undefined ? stringParam(req.body.domain, 40) : row.domain;
    if (!DOMAIN_LABELS[domain]) throw new HttpError(400, 'invalid_domain', 'Lĩnh vực không hợp lệ.');
    run(
      `UPDATE glossary_terms SET term = ?, definition = ?, domain = ?, locked = 1, version = version + 1,
         updated_at = ?, search_norm = ? WHERE id = ?`,
      [term, definition, domain, now(), normalizeVi(`${term} ${definition}`), id]
    );
    recordAudit(req, 'glossary_updated', { entityType: 'glossary', entityId: id, details: { term } });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.delete('/glossary/:id', requirePermission('glossary.manage'), (req, res, next) => {
  try {
    const id = intParam(req.params.id, 0, { min: 1, max: 1e9 });
    run('DELETE FROM glossary_terms WHERE id = ?', [id]);
    recordAudit(req, 'glossary_deleted', { entityType: 'glossary', entityId: id });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Hóa chất
// ---------------------------------------------------------------------------
const CHEM_FIELDS = ['name', 'common_names', 'cas_number', 'molecular_formula', 'category', 'description',
  'hazards', 'exposure_routes', 'health_effects', 'prevention', 'response', 'source_url'];

router.get('/chemicals', requirePermission('content.read'), (req, res) => {
  const q = stringParam(req.query.q, 100);
  const rows = getAll(
    `SELECT id, name, cas_number, molecular_formula, category, verification_status, locked, updated_at
     FROM chemicals ${q ? 'WHERE search_norm LIKE ?' : ''} ORDER BY name LIMIT 200`,
    q ? [`%${normalizeVi(q)}%`] : []
  );
  res.json({ chemicals: rows });
});

router.post('/chemicals', requirePermission('chemicals.manage'), (req, res, next) => {
  try {
    const name = stringParam(req.body?.name, 200).trim();
    if (name.length < 3) throw new HttpError(400, 'invalid_input', 'Tên hóa chất quá ngắn.');
    const values = CHEM_FIELDS.map((field) => stringParam(req.body?.[field], 4000) || null);
    values[0] = name;
    const timestamp = now();
    const searchNorm = normalizeVi(values.filter(Boolean).join(' '));
    const result = run(
      `INSERT INTO chemicals (${CHEM_FIELDS.join(', ')}, verification_status, data_origin, license, version,
         locked, created_at, updated_at, search_norm)
       VALUES (${CHEM_FIELDS.map(() => '?').join(', ')}, 'editorial', 'admin', 'Nội bộ biên soạn', 1, 1, ?, ?, ?)`,
      [...values, timestamp, timestamp, searchNorm]
    );
    recordAudit(req, 'chemical_created', { entityType: 'chemical', entityId: result.lastInsertRowid, details: { name } });
    res.status(201).json({ id: Number(result.lastInsertRowid) });
  } catch (error) {
    next(error);
  }
});

router.patch('/chemicals/:id', requirePermission('chemicals.manage'), (req, res, next) => {
  try {
    const id = intParam(req.params.id, 0, { min: 1, max: 1e9 });
    const row = getOne('SELECT * FROM chemicals WHERE id = ?', [id]);
    if (!row) throw new HttpError(404, 'not_found', 'Không tìm thấy hóa chất.');
    const values = CHEM_FIELDS.map((field) => (req.body?.[field] !== undefined
      ? stringParam(req.body[field], 4000) || null : row[field]));
    run(
      `UPDATE chemicals SET ${CHEM_FIELDS.map((field) => `${field} = ?`).join(', ')}, locked = 1,
         version = version + 1, updated_at = ?, search_norm = ? WHERE id = ?`,
      [...values, now(), normalizeVi(values.filter(Boolean).join(' ')), id]
    );
    recordAudit(req, 'chemical_updated', { entityType: 'chemical', entityId: id, details: { name: values[0] } });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.delete('/chemicals/:id', requirePermission('chemicals.manage'), (req, res, next) => {
  try {
    const id = intParam(req.params.id, 0, { min: 1, max: 1e9 });
    run('DELETE FROM chemicals WHERE id = ?', [id]);
    recordAudit(req, 'chemical_deleted', { entityType: 'chemical', entityId: id });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Nguồn & đồng bộ
// ---------------------------------------------------------------------------
router.get('/sources', requirePermission('sources.manage'), (req, res) => {
  res.json({
    sources: getAll('SELECT * FROM external_sources ORDER BY number'),
    syncable: syncableSources(),
    logs: recentSyncLogs(20)
  });
});

router.patch('/sources/:key', requirePermission('sources.manage'), (req, res, next) => {
  try {
    const key = stringParam(req.params.key, 60);
    const source = getOne('SELECT * FROM external_sources WHERE source_key = ?', [key]);
    if (!source) throw new HttpError(404, 'not_found', 'Không tìm thấy nguồn.');
    if (!source.connector) throw new HttpError(400, 'reference_only', 'Nguồn này chỉ tham chiếu, không bật/tắt đồng bộ.');
    const enabled = req.body?.enabled ? 1 : 0;
    run('UPDATE external_sources SET enabled = ?, updated_at = ? WHERE source_key = ?', [enabled, now(), key]);
    recordAudit(req, 'source_toggled', { entityType: 'source', entityId: key, details: { enabled } });
    res.json({ ok: true, enabled: Boolean(enabled) });
  } catch (error) {
    next(error);
  }
});

router.post('/sync', requirePermission('sync.run'), (req, res, next) => {
  try {
    const keys = Array.isArray(req.body?.sources)
      ? req.body.sources.map((k) => stringParam(k, 60)).filter(Boolean)
      : [];
    const job = startSyncJob(keys, req.session.user.username);
    recordAudit(req, 'sync_started', { entityType: 'sync', entityId: job.id, details: { keys: job.keys } });
    res.status(202).json({ job });
  } catch (error) {
    next(error);
  }
});

router.get('/sync/:jobId', requirePermission('sync.run'), (req, res, next) => {
  try {
    const job = getSyncJob(stringParam(req.params.jobId, 80));
    if (!job) throw new HttpError(404, 'not_found', 'Không tìm thấy tiến trình đồng bộ.');
    res.json({ job });
  } catch (error) {
    next(error);
  }
});

router.get('/sync-logs', requirePermission('sync.run'), (req, res) => {
  res.json({ logs: recentSyncLogs(50) });
});

// ---------------------------------------------------------------------------
// Người dùng
// ---------------------------------------------------------------------------
router.get('/users', requirePermission('users.manage'), (req, res) => {
  const users = getAll(
    `SELECT u.id, u.username, u.email, u.is_active, u.must_change_password, u.totp_enabled,
            u.last_login_at, u.created_at, r.name AS role
     FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.id`
  );
  res.json({ users });
});

router.post('/users', requirePermission('users.manage'), asyncHandler(async (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const role = ['admin', 'editor', 'viewer'].includes(req.body?.role) ? req.body.role : 'viewer';
  const email = stringParam(req.body?.email, 200).trim() || null;
  if (!/^[a-z0-9][a-z0-9._-]{2,40}$/.test(username)) {
    throw new HttpError(400, 'invalid_username', 'Tên đăng nhập 3–41 ký tự, chỉ chữ thường, số, dấu chấm/gạch.');
  }
  const weak = validatePasswordStrength(password);
  if (weak) throw new HttpError(400, 'weak_password', weak);
  if (getOne('SELECT id FROM users WHERE username = ?', [username])) {
    throw new HttpError(409, 'duplicate', 'Tên đăng nhập đã tồn tại.');
  }
  const roleRow = getOne('SELECT id FROM roles WHERE name = ?', [role]);
  const hash = await hashPassword(password);
  const timestamp = now();
  const result = run(
    `INSERT INTO users (username, email, password_hash, role_id, is_active, must_change_password, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, 1, ?, ?)`,
    [username, email, hash, roleRow.id, timestamp, timestamp]
  );
  recordAudit(req, 'user_created', { entityType: 'user', entityId: result.lastInsertRowid, details: { username, role } });
  res.status(201).json({ id: Number(result.lastInsertRowid) });
}));

router.patch('/users/:id', requirePermission('users.manage'), (req, res, next) => {
  try {
    const id = intParam(req.params.id, 0, { min: 1, max: 1e9 });
    const user = getOne('SELECT * FROM users WHERE id = ?', [id]);
    if (!user) throw new HttpError(404, 'not_found', 'Không tìm thấy người dùng.');
    const role = ['admin', 'editor', 'viewer'].includes(req.body?.role) ? req.body.role : null;
    if (user.id === req.session.user.id && role && role !== 'admin') {
      throw new HttpError(400, 'self_demote', 'Không thể tự hạ quyền chính mình.');
    }
    if (user.id === req.session.user.id && req.body?.isActive === false) {
      throw new HttpError(400, 'self_disable', 'Không thể tự vô hiệu hóa tài khoản đang đăng nhập.');
    }
    if (role) {
      const roleRow = getOne('SELECT id FROM roles WHERE name = ?', [role]);
      run('UPDATE users SET role_id = ?, updated_at = ? WHERE id = ?', [roleRow.id, now(), id]);
      getPermissions(role);
    }
    if (req.body?.isActive !== undefined) {
      run('UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?', [req.body.isActive ? 1 : 0, now(), id]);
      if (!req.body.isActive) revokeUserSessions(id);
    }
    if (req.body?.email !== undefined) {
      run('UPDATE users SET email = ?, updated_at = ? WHERE id = ?', [stringParam(req.body.email, 200) || null, now(), id]);
    }
    recordAudit(req, 'user_updated', { entityType: 'user', entityId: id, details: { role, isActive: req.body?.isActive } });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.post('/users/:id/reset-password', requirePermission('users.manage'), asyncHandler(async (req, res) => {
  const id = intParam(req.params.id, 0, { min: 1, max: 1e9 });
  const password = String(req.body?.password || '');
  const user = getOne('SELECT username FROM users WHERE id = ?', [id]);
  if (!user) throw new HttpError(404, 'not_found', 'Không tìm thấy người dùng.');
  const weak = validatePasswordStrength(password);
  if (weak) throw new HttpError(400, 'weak_password', weak);
  const hash = await hashPassword(password);
  run('UPDATE users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?', [hash, now(), id]);
  revokeUserSessions(id);
  recordAudit(req, 'password_reset', { entityType: 'user', entityId: id, details: { username: user.username } });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Audit, backup, import, settings
// ---------------------------------------------------------------------------
router.get('/audit', requirePermission('audit.read'), (req, res) => {
  const limit = intParam(req.query.limit, 50, { min: 1, max: 200 });
  const offset = intParam(req.query.offset, 0, { min: 0, max: 100000 });
  res.json({ logs: listAudit({ limit, offset }) });
});

router.get('/backups', requirePermission('backup.run'), (req, res) => {
  res.json({ backups: listBackups(), db: dbInfo() });
});

router.post('/backup', requirePermission('backup.run'), (req, res, next) => {
  try {
    const backup = createBackup(req.session.user.username);
    recordAudit(req, 'backup_created', { entityType: 'backup', entityId: backup.filename });
    res.status(201).json({ backup });
  } catch (error) {
    next(error);
  }
});

router.post('/import', requirePermission('content.write'), (req, res, next) => {
  try {
    const type = stringParam(req.body?.type, 30);
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) throw new HttpError(400, 'invalid_input', 'Danh sách nhập rỗng.');
    if (items.length > 500) throw new HttpError(400, 'too_many', 'Tối đa 500 bản ghi mỗi lần nhập.');
    let imported = 0;
    const timestamp = now();

    if (type === 'glossary') {
      if (!req.session.user.role === 'admin' && !req.session.permissions.includes('glossary.manage')) {
        throw new HttpError(403, 'forbidden', 'Cần quyền quản lý thuật ngữ.');
      }
      const stmt = getDb().prepare(
        `INSERT INTO glossary_terms (term, definition, domain, source_url, verification_status, data_origin,
           license, version, locked, created_at, updated_at, search_norm)
         VALUES (?, ?, ?, ?, 'editorial', 'import', 'Nội bộ biên soạn', 1, 0, ?, ?, ?)
         ON CONFLICT(term, domain) DO UPDATE SET definition = excluded.definition, updated_at = excluded.updated_at,
           search_norm = excluded.search_norm`
      );
      for (const item of items) {
        const term = stringParam(item.term, 200).trim();
        const definition = stringParam(item.definition, 3000).trim();
        const domain = stringParam(item.domain, 40);
        if (!term || !definition || !DOMAIN_LABELS[domain]) continue;
        stmt.run(term, definition, domain, stringParam(item.sourceUrl, 500) || null, timestamp, timestamp,
          normalizeVi(`${term} ${definition}`));
        imported += 1;
      }
    } else if (type === 'chemicals') {
      if (req.session.user.role !== 'admin' && !req.session.permissions.includes('chemicals.manage')) {
        throw new HttpError(403, 'forbidden', 'Cần quyền quản lý hóa chất.');
      }
      const stmt = getDb().prepare(
        `INSERT INTO chemicals (name, common_names, cas_number, molecular_formula, category, description,
           hazards, exposure_routes, health_effects, prevention, response, source_url, sources_json,
           verification_status, data_origin, license, version, locked, created_at, updated_at, search_norm)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'editorial', 'import', 'Nội bộ biên soạn', 1, 0, ?, ?, ?)`
      );
      for (const item of items) {
        const name = stringParam(item.name, 200).trim();
        if (!name) continue;
        const values = CHEM_FIELDS.map((field) => stringParam(item[field] ?? item[field.replace(/_([a-z])/g, (m, c) => c.toUpperCase())], 4000) || null);
        values[0] = name;
        stmt.run(...values, JSON.stringify(item.sources || []), timestamp, timestamp,
          normalizeVi(values.filter(Boolean).join(' ')));
        imported += 1;
      }
    } else {
      throw new HttpError(400, 'invalid_type', 'Chỉ hỗ trợ nhập glossary hoặc chemicals.');
    }

    recordAudit(req, 'data_imported', { entityType: type, details: { count: imported } });
    res.json({ ok: true, imported });
  } catch (error) {
    next(error);
  }
});

router.get('/settings', requirePermission('settings.manage'), (req, res) => {
  const settings = Object.fromEntries(getAll('SELECT setting_key, value FROM site_settings').map((r) => [r.setting_key, r.value]));
  res.json({ settings });
});

router.patch('/settings', requirePermission('settings.manage'), (req, res, next) => {
  try {
    const allowed = ['site_title', 'site_description'];
    const updated = {};
    for (const key of allowed) {
      if (req.body?.[key] !== undefined) {
        const value = stringParam(req.body[key], 500);
        run(
          `INSERT INTO site_settings (setting_key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(setting_key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
          [key, value, now()]
        );
        updated[key] = value;
      }
    }
    recordAudit(req, 'settings_updated', { entityType: 'settings', details: updated });
    res.json({ ok: true, updated });
  } catch (error) {
    next(error);
  }
});

export default router;
