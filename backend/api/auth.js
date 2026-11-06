import express from 'express';
import { config } from '../config/config.js';
import { getOne, run } from '../database/db.js';
import {
  hashPassword, verifyPassword, validatePasswordStrength, createSession, sessionCookie,
  clearSessionCookie, readCookie, hashToken, revokeSession, revokeUserSessions,
  generateTotpSecret, verifyTotp, totpUri, userById
} from '../auth/security.js';
import { asyncHandler, HttpError, rateLimiter, requireAuth, requireCsrf } from '../middleware/http.js';
import { recordAudit } from '../services/admin.js';

const router = express.Router();
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

const loginLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyFn: (req) => `${req.ip}|${String(req.body?.username || '').toLowerCase().slice(0, 60)}`
});

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase().slice(0, 60);
}

function auditAnonymous(req, username, action, details) {
  try {
    run(
      `INSERT INTO audit_logs (user_id, actor, action, entity_type, entity_id, details, ip, user_agent, created_at)
       VALUES (NULL, ?, ?, 'auth', NULL, ?, ?, ?, ?)`,
      [username || 'anonymous', action, details ? JSON.stringify(details) : null, req.ip || null,
        String(req.get('user-agent') || '').slice(0, 300), new Date().toISOString()]
    );
  } catch {
    /* audit không được làm hỏng luồng đăng nhập */
  }
}

let dummyHashPromise = null;
async function dummyCompare(password) {
  if (!dummyHashPromise) dummyHashPromise = hashPassword('dummy-password-for-timing');
  const hash = await dummyHashPromise;
  await verifyPassword(password, hash);
}

router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password || '');
  const otp = String(req.body?.otp || '').trim();
  if (!username || !password) {
    throw new HttpError(400, 'invalid_input', 'Vui lòng nhập tên đăng nhập và mật khẩu.');
  }

  const user = getOne(
    `SELECT u.*, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.username = ?`,
    [username]
  );

  if (!user) {
    await dummyCompare(password);
    run(
      `INSERT INTO login_attempts (username, ip, success, created_at) VALUES (?, ?, 0, ?)`,
      [username, req.ip || null, new Date().toISOString()]
    );
    auditAnonymous(req, username, 'login_failed', { reason: 'unknown_user' });
    throw new HttpError(401, 'invalid_credentials', 'Tên đăng nhập hoặc mật khẩu không đúng.');
  }

  if (!user.is_active) {
    auditAnonymous(req, username, 'login_blocked', { reason: 'inactive' });
    throw new HttpError(403, 'account_disabled', 'Tài khoản đã bị vô hiệu hóa.');
  }

  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    auditAnonymous(req, username, 'login_blocked', { reason: 'locked' });
    throw new HttpError(429, 'account_locked', `Tài khoản tạm khóa do đăng nhập sai nhiều lần. Thử lại sau ${LOCK_MINUTES} phút.`);
  }

  const passwordOk = await verifyPassword(password, user.password_hash);
  if (!passwordOk) {
    const failed = Number(user.failed_attempts || 0) + 1;
    const lockUntil = failed >= MAX_FAILED
      ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString()
      : user.locked_until;
    run('UPDATE users SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?', [
      failed, lockUntil, new Date().toISOString(), user.id
    ]);
    run('INSERT INTO login_attempts (username, ip, success, created_at) VALUES (?, ?, 0, ?)', [
      username, req.ip || null, new Date().toISOString()
    ]);
    auditAnonymous(req, username, 'login_failed', { reason: 'bad_password', failed });
    throw new HttpError(401, 'invalid_credentials', 'Tên đăng nhập hoặc mật khẩu không đúng.');
  }

  if (user.totp_enabled) {
    if (!otp) {
      auditAnonymous(req, username, 'login_totp_required', {});
      throw new HttpError(401, 'totp_required', 'Nhập mã xác thực 6 chữ số từ ứng dụng TOTP.');
    }
    if (!verifyTotp(user.totp_secret, otp)) {
      auditAnonymous(req, username, 'login_failed', { reason: 'bad_totp' });
      throw new HttpError(401, 'invalid_totp', 'Mã xác thực không đúng hoặc đã hết hạn.');
    }
  }

  // Đăng nhập thành công: reset bộ đếm, tạo phiên mới.
  const timestamp = new Date().toISOString();
  run(
    `UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?`,
    [timestamp, timestamp, user.id]
  );
  run('INSERT INTO login_attempts (username, ip, success, created_at) VALUES (?, ?, 1, ?)', [
    username, req.ip || null, timestamp
  ]);

  const session = createSession(user.id, req);
  res.setHeader('Set-Cookie', sessionCookie(session.token, session.expires));
  recordAudit(req, 'login_success', { entityType: 'user', entityId: user.id });

  const nextRaw = String(req.body?.next || '/dashboard.html');
  const next = nextRaw.startsWith('/') && !nextRaw.startsWith('//') ? nextRaw : '/dashboard.html';
  res.json({
    ok: true,
    user: {
      id: user.id, username: user.username, role: user.role, mustChangePassword: Boolean(user.must_change_password)
    },
    csrfToken: session.csrf,
    mustChangePassword: Boolean(user.must_change_password),
    redirect: next
  });
}));

router.get('/me', requireAuth, (req, res) => {
  res.json({
    user: req.session.user,
    permissions: req.session.permissions,
    csrfToken: req.session.csrf,
    expiresAt: req.session.expiresAt
  });
});

router.post('/logout', requireAuth, requireCsrf, (req, res) => {
  revokeSession(req.session.tokenHash);
  res.setHeader('Set-Cookie', clearSessionCookie());
  recordAudit(req, 'logout', { entityType: 'session' });
  res.json({ ok: true });
});

router.post('/change-password', requireAuth, requireCsrf, asyncHandler(async (req, res) => {
  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  const user = getOne('SELECT * FROM users WHERE id = ?', [req.session.user.id]);
  if (!user) throw new HttpError(401, 'unauthenticated', 'Phiên không hợp lệ.');
  if (!(await verifyPassword(currentPassword, user.password_hash))) {
    throw new HttpError(400, 'bad_password', 'Mật khẩu hiện tại không đúng.');
  }
  const weak = validatePasswordStrength(newPassword);
  if (weak) throw new HttpError(400, 'weak_password', weak);
  if (newPassword === currentPassword) {
    throw new HttpError(400, 'same_password', 'Mật khẩu mới phải khác mật khẩu hiện tại.');
  }
  const hash = await hashPassword(newPassword);
  run('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?', [
    hash, new Date().toISOString(), user.id
  ]);
  revokeUserSessions(user.id, req.session.tokenHash);
  recordAudit(req, 'password_changed', { entityType: 'user', entityId: user.id });
  res.json({ ok: true });
}));

router.post('/totp/setup', requireAuth, requireCsrf, (req, res) => {
  const secret = generateTotpSecret();
  run('UPDATE users SET totp_secret = ?, totp_enabled = 0, updated_at = ? WHERE id = ?', [
    secret, new Date().toISOString(), req.session.user.id
  ]);
  res.json({ secret, uri: totpUri(req.session.user.username, secret) });
});

router.post('/totp/enable', requireAuth, requireCsrf, (req, res, next) => {
  try {
    const code = String(req.body?.code || '');
    const user = getOne('SELECT totp_secret FROM users WHERE id = ?', [req.session.user.id]);
    if (!user?.totp_secret) throw new HttpError(400, 'totp_not_setup', 'Chưa khởi tạo TOTP.');
    if (!verifyTotp(user.totp_secret, code)) throw new HttpError(400, 'invalid_totp', 'Mã xác thực không đúng.');
    run('UPDATE users SET totp_enabled = 1, updated_at = ? WHERE id = ?', [
      new Date().toISOString(), req.session.user.id
    ]);
    recordAudit(req, 'totp_enabled', { entityType: 'user', entityId: req.session.user.id });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.post('/totp/disable', requireAuth, requireCsrf, asyncHandler(async (req, res) => {
  const user = getOne('SELECT password_hash FROM users WHERE id = ?', [req.session.user.id]);
  if (!user || !(await verifyPassword(String(req.body?.password || ''), user.password_hash))) {
    throw new HttpError(400, 'bad_password', 'Mật khẩu không đúng.');
  }
  run('UPDATE users SET totp_enabled = 0, totp_secret = NULL, updated_at = ? WHERE id = ?', [
    new Date().toISOString(), req.session.user.id
  ]);
  recordAudit(req, 'totp_disabled', { entityType: 'user', entityId: req.session.user.id });
  res.json({ ok: true });
}));

// Tiện ích cho trang quản trị: thông tin phiên hiện tại sau khi tải lại.
router.get('/session-info', (req, res) => {
  const token = readCookie(req, config.cookieName);
  if (!token) return res.json({ authenticated: false });
  const row = getOne(
    `SELECT s.expires_at, u.id FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.revoked_at IS NULL`, [hashToken(token)]
  );
  res.json({ authenticated: Boolean(row), expiresAt: row?.expires_at || null });
});

export default router;
