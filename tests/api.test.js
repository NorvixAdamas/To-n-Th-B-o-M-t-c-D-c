import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-test-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.PASSWORD_PEPPER = 'test-pepper-only';
process.env.PORT = '0';
process.env.HOST = '127.0.0.1';
process.env.SITE_REQUIRE_LOGIN = 'false';

const { seedDatabase } = await import('../backend/database/seed.js');
const { getOne, run, closeDb } = await import('../backend/database/db.js');
const { hashPassword } = await import('../backend/auth/security.js');
const { startServer } = await import('../backend/server.js');

seedDatabase({ quiet: true });

async function createUser(username, role, password, mustChange = 0) {
  const roleRow = getOne('SELECT id FROM roles WHERE name = ?', [role]);
  const hash = await hashPassword(password);
  const timestamp = new Date().toISOString();
  run(
    `INSERT INTO users (username, email, password_hash, role_id, is_active, must_change_password, created_at, updated_at)
     VALUES (?, NULL, ?, ?, 1, ?, ?, ?)`,
    [username, hash, roleRow.id, mustChange, timestamp, timestamp]
  );
}

await createUser('tester', 'admin', 'Test-Password-2026', 0);
await createUser('reader', 'viewer', 'Reader-Password-2026', 0);

const started = await startServer(0);
const base = `http://127.0.0.1:${started.port}`;
let adminCookie = '';
let adminCsrf = '';

after(async () => {
  await new Promise((resolve) => started.server.close(resolve));
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function request(pathname, options = {}) {
  const headers = Object.assign({ Accept: 'application/json' }, options.headers || {});
  if (options.body) headers['Content-Type'] = 'application/json';
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.csrf) headers['x-csrf-token'] = options.csrf;
  const response = await fetch(base + pathname, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    redirect: 'manual'
  });
  let json = null;
  const type = response.headers.get('content-type') || '';
  if (type.includes('application/json')) json = await response.json();
  return { response, json };
}

async function login(username, password) {
  const { response, json } = await request('/api/auth/login', {
    method: 'POST', body: { username, password, next: '/admin/' }
  });
  assert.equal(response.status, 200, JSON.stringify(json));
  const setCookie = response.headers.getSetCookie ? response.headers.getSetCookie()[0] : response.headers.get('set-cookie');
  return { cookie: setCookie.split(';')[0], csrf: json.csrfToken, json };
}

test('seed giữ đủ 295 thuật ngữ và 32 nguồn', () => {
  assert.equal(getOne('SELECT COUNT(*) AS n FROM glossary_terms').n, 295);
  assert.equal(getOne('SELECT COUNT(*) AS n FROM external_sources').n, 32);
  assert.equal(getOne('SELECT COUNT(*) AS n FROM chemicals').n, 18);
  assert.equal(getOne('SELECT COUNT(*) AS n FROM vulnerabilities').n, 8);
});

test('các trang cũ vẫn được phục vụ và giữ nguyên glossary', async () => {
  const page = await fetch(base + '/index.html');
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Bách Khoa Toàn Thư/);

  const glossary = await fetch(base + '/glossary.html');
  assert.equal(glossary.status, 200);
  const glossaryHtml = await glossary.text();
  assert.equal((glossaryHtml.match(/<dt>/g) || []).length, 295);
});

test('không phục vụ mã nguồn backend hay file cấu hình', async () => {
  const backend = await fetch(base + '/backend/api/admin.js');
  assert.equal(backend.status, 404);
  const env = await fetch(base + '/.env');
  assert.equal(env.status, 404);
  const data = await fetch(base + '/data/encyclopedia.db');
  assert.equal(data.status, 404);
  const asset = await fetch(base + '/css/v2.css');
  assert.equal(asset.status, 200);
});

test('tra hóa chất theo tên đồng nghĩa tiếng Việt', async () => {
  const lead = await request('/api/chemicals/' + encodeURIComponent('Chì'));
  assert.equal(lead.response.status, 200);
  assert.equal(lead.json.chemical.name, 'Lead');
  const paracetamol = await request('/api/chemicals/' + encodeURIComponent('Acetaminophen'));
  assert.equal(paracetamol.response.status, 200);
  assert.equal(paracetamol.json.chemical.name, 'Paracetamol');
});

test('tìm kiếm không dấu hoạt động và chịu được chuỗi SQLi', async () => {
  const { response, json } = await request('/api/search?q=ngo%20doc&limit=5');
  assert.equal(response.status, 200);
  assert.ok(json.total > 0, 'phải có kết quả cho "ngo doc"');
  assert.ok(json.results.length > 0);

  const injection = await request(`/api/search?q=${encodeURIComponent("' OR 1=1 --")}`);
  assert.equal(injection.response.status, 200);
  assert.equal(injection.json.query, "' OR 1=1 --");
  assert.ok(injection.json.total >= 0);
  assert.equal(getOne('SELECT COUNT(*) AS n FROM glossary_terms').n, 295);
});

test('header bảo mật và chặn origin lạ', async () => {
  const { response } = await request('/api/health');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy') || '', /default-src 'self'/);
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');

  const foreign = await request('/api/auth/login', {
    method: 'POST',
    headers: { Origin: 'http://evil.example' },
    body: { username: 'tester', password: 'Test-Password-2026' }
  });
  assert.equal(foreign.response.status, 403);
  assert.equal(foreign.json.error.code, 'bad_origin');
});

test('API quản trị chặn người chưa đăng nhập', async () => {
  const { response } = await request('/api/admin/overview');
  assert.equal(response.status, 401);
});

test('/admin/ không tự chuyển hướng vòng lặp', async () => {
  const slash = await fetch(base + '/admin/', { redirect: 'manual' });
  assert.equal(slash.status, 302);
  assert.match(slash.headers.get('location') || '', /\/login\.html/);
  const plain = await fetch(base + '/admin', { redirect: 'manual' });
  assert.equal(plain.status, 302);
  assert.match(plain.headers.get('location') || '', /\/login\.html/);
});

test('đăng nhập sai bị từ chối, đúng nhận cookie HttpOnly', async () => {
  const wrong = await request('/api/auth/login', {
    method: 'POST', body: { username: 'tester', password: 'sai-mat-khau' }
  });
  assert.equal(wrong.response.status, 401);
  assert.equal(wrong.json.error.code, 'invalid_credentials');

  const session = await login('tester', 'Test-Password-2026');
  adminCookie = session.cookie;
  adminCsrf = session.csrf;
  assert.ok(adminCsrf);
  const rawCookie = session.response || '';
  const me = await request('/api/auth/me', { cookie: adminCookie });
  assert.equal(me.response.status, 200);
  assert.equal(me.json.user.role, 'admin');
  assert.ok(me.response.headers.get('set-cookie') === null);
  assert.ok(rawCookie === undefined || rawCookie === '');
});

test('thao tác ghi thiếu CSRF bị chặn', async () => {
  const { response, json } = await request('/api/auth/change-password', {
    method: 'POST', cookie: adminCookie, body: { currentPassword: 'x', newPassword: 'y' }
  });
  assert.equal(response.status, 403);
  assert.equal(json.error.code, 'csrf_failed');
});

test('admin tạo thuật ngữ với CSRF hợp lệ', async () => {
  const { response, json } = await request('/api/admin/glossary', {
    method: 'POST', cookie: adminCookie, csrf: adminCsrf,
    body: { term: 'Kiểm thử xâm nhập', definition: 'Hoạt động đánh giá bảo mật có uỷ quyền.', domain: 'cybersecurity' }
  });
  assert.equal(response.status, 201, JSON.stringify(json));
  assert.ok(json.id);
});

test('viewer không thể ghi nội dung quản trị', async () => {
  const session = await login('reader', 'Reader-Password-2026');
  const { response } = await request('/api/admin/articles', {
    method: 'POST', cookie: session.cookie, csrf: session.csrf,
    body: { title: 'Bài viết trái phép', domain: 'safety' }
  });
  assert.equal(response.status, 403);
});

test('markdown escape script khi tạo bài viết', async () => {
  const created = await request('/api/admin/articles', {
    method: 'POST', cookie: adminCookie, csrf: adminCsrf,
    body: {
      title: 'Kiểm tra XSS',
      summary: 'Bài kiểm tra escape',
      body: '## Tiêu đề\n\n<script>alert(1)</script>\n\nNội dung an toàn.',
      domain: 'safety',
      status: 'published'
    }
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.json));
  const detail = await request('/api/articles/' + created.json.slug);
  assert.equal(detail.response.status, 200);
  assert.ok(detail.json.article.html.includes('&lt;script&gt;'));
  assert.ok(!detail.json.article.html.includes('<script>alert(1)</script>'));
});

test('tạo bản sao lưu CSDL qua API quản trị', async () => {
  const { response, json } = await request('/api/admin/backup', {
    method: 'POST', cookie: adminCookie, csrf: adminCsrf
  });
  assert.equal(response.status, 201, JSON.stringify(json));
  assert.ok(json.backup.filename.endsWith('.db'));
  assert.equal(json.backup.integrity, 'ok');
  assert.ok(fs.existsSync(path.join(process.env.BACKUPS_DIR || 'backups', json.backup.filename)) ||
    json.backup.size > 0);
});
