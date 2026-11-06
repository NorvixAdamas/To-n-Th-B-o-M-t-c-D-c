import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { getDb, getOne, run } from '../database/db.js';
import { config } from '../config/config.js';

const BCRYPT_ROUNDS = 12;
const KEY_LENGTH = 32;

function peppered(password) {
  // Pepper được nối sau mật khẩu; giới hạn độ dài đầu vào trước khi băm.
  return `${String(password).slice(0, 200)}\u0000${config.passwordPepper}`;
}

export async function hashPassword(password) {
  return bcrypt.hash(peppered(password), BCRYPT_ROUNDS);
}

export async function verifyPassword(password, hash) {
  try {
    return await bcrypt.compare(peppered(password), hash);
  } catch {
    return false;
  }
}

export function validatePasswordStrength(password) {
  const value = String(password || '');
  if (value.length < 12) return 'Mật khẩu phải có ít nhất 12 ký tự.';
  if (value.length > 200) return 'Mật khẩu quá dài.';
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/[0-9]/.test(value)) {
    return 'Mật khẩu cần có chữ thường, chữ hoa và chữ số.';
  }
  if (/^(password|matkhau|admin|123456)/i.test(value)) return 'Mật khẩu quá dễ đoán.';
  return null;
}

export function randomToken(bytes = KEY_LENGTH) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

// ---------------------------------------------------------------------------
// Phiên đăng nhập — cookie HttpOnly chứa token ngẫu nhiên; CSDL chỉ lưu hash.
// ---------------------------------------------------------------------------
export function createSession(userId, req) {
  const db = getDb();
  const token = randomToken();
  const csrf = randomToken(24);
  const created = new Date();
  const expires = new Date(created.getTime() + config.sessionTtlHours * 3600 * 1000);
  db.prepare(
    `INSERT INTO sessions (token_hash, user_id, csrf_secret, ip, user_agent, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    hashToken(token), userId, csrf, req.ip || null,
    String(req.get('user-agent') || '').slice(0, 300),
    created.toISOString(), created.toISOString(), expires.toISOString()
  );
  return { token, csrf, expires };
}

export function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (key === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function sessionCookie(token, expires) {
  const parts = [
    `${config.cookieName}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Expires=${expires.toUTCString()}`,
    'Max-Age=' + Math.max(0, Math.floor((expires.getTime() - Date.now()) / 1000))
  ];
  if (config.secureCookie) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie() {
  const parts = [`${config.cookieName}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (config.secureCookie) parts.push('Secure');
  return parts.join('; ');
}

export function loadSession(req) {
  const token = readCookie(req, config.cookieName);
  if (!token) return null;
  const db = getDb();
  const tokenHash = hashToken(token);
  const row = db.prepare(
    `SELECT s.token_hash, s.csrf_secret, s.expires_at, s.revoked_at,
            u.id AS user_id, u.username, u.email, u.is_active, u.must_change_password, u.totp_enabled,
            r.name AS role
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     JOIN roles r ON r.id = u.role_id
     WHERE s.token_hash = ?`
  ).get(tokenHash);
  if (!row) return null;
  if (row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ?').run(new Date().toISOString(), tokenHash);
    return null;
  }
  if (!row.is_active) return null;

  const lastSeen = Date.now();
  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').run(
    new Date(lastSeen).toISOString(), tokenHash
  );

  return {
    tokenHash,
    csrf: row.csrf_secret,
    expiresAt: row.expires_at,
    user: {
      id: row.user_id,
      username: row.username,
      email: row.email,
      role: row.role,
      mustChangePassword: Boolean(row.must_change_password),
      totpEnabled: Boolean(row.totp_enabled)
    },
    permissions: getPermissions(row.role)
  };
}

let permissionCache = null;

export function getPermissions(roleName) {
  if (!permissionCache) {
    permissionCache = new Map();
    const rows = getDb().prepare(
      `SELECT r.name AS role, p.code AS code FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id`
    ).all();
    for (const row of rows) {
      if (!permissionCache.has(row.role)) permissionCache.set(row.role, new Set());
      permissionCache.get(row.role).add(row.code);
    }
  }
  return Array.from(permissionCache.get(roleName) || []);
}

export function clearPermissionCache() {
  permissionCache = null;
}

export function revokeSession(tokenHash) {
  run('UPDATE sessions SET revoked_at = ? WHERE token_hash = ?', [new Date().toISOString(), tokenHash]);
}

export function revokeUserSessions(userId, exceptTokenHash = null) {
  if (exceptTokenHash) {
    run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND token_hash <> ?', [
      new Date().toISOString(), userId, exceptTokenHash
    ]);
  } else {
    run('UPDATE sessions SET revoked_at = ? WHERE user_id = ?', [new Date().toISOString(), userId]);
  }
}

// ---------------------------------------------------------------------------
// TOTP (RFC 6238) — bí mật lưu trong CSDL, chỉ bật sau khi người dùng xác nhận.
// ---------------------------------------------------------------------------
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(secret) {
  const clean = String(secret || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const output = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

export function totpCode(secret, counter) {
  const key = base32Decode(secret);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 1000000).padStart(6, '0');
}

export function verifyTotp(secret, code, window = 1) {
  if (!/^\d{6}$/.test(String(code || ''))) return false;
  const counter = Math.floor(Date.now() / 30000);
  for (let offset = -window; offset <= window; offset += 1) {
    if (totpCode(secret, counter + offset) === String(code)) return true;
  }
  return false;
}

export function totpUri(username, secret) {
  return `otpauth://totp/${encodeURIComponent(`BachKhoa:${username}`)}?secret=${secret}&issuer=BachKhoa&digits=6&period=30`;
}

export function userById(id) {
  return getOne(
    `SELECT u.id, u.username, u.email, u.is_active, u.must_change_password, u.totp_enabled,
            u.last_login_at, u.failed_attempts, u.locked_until, r.name AS role
     FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`, [id]
  );
}
