import { loadSession, safeEqual } from '../auth/security.js';
import { config } from '../config/config.js';

export class HttpError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// ---------------------------------------------------------------------------
// Header bảo mật
// ---------------------------------------------------------------------------
export function securityHeaders(req, res, next) {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join('; ');

  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (config.isProduction || config.secureCookie) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  if (req.path.startsWith('/api/') || req.path.startsWith('/admin')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
}

// ---------------------------------------------------------------------------
// Giới hạn tần suất trong bộ nhớ (đủ cho một instance; ghi chú trong SECURITY.md)
// ---------------------------------------------------------------------------
export function rateLimiter({ windowMs = 60000, max = 120, keyFn = (req) => req.ip } = {}) {
  const hits = new Map();
  const timer = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, entry] of hits) {
      if (entry.start < cutoff) hits.delete(key);
    }
  }, windowMs);
  timer.unref?.();

  return (req, res, next) => {
    const key = keyFn(req) || 'unknown';
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.start < now - windowMs) {
      entry = { start: now, count: 0 };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.start + windowMs - now) / 1000));
      return res.status(429).json({ error: { code: 'rate_limited', message: 'Quá nhiều yêu cầu. Vui lòng thử lại sau.' } });
    }
    next();
  };
}

// ---------------------------------------------------------------------------
// Phiên & quyền
// ---------------------------------------------------------------------------
export function attachSession(req, res, next) {
  req.session = loadSession(req);
  next();
}

export function requireAuth(req, res, next) {
  if (!req.session) {
    return res.status(401).json({ error: { code: 'unauthenticated', message: 'Cần đăng nhập.' } });
  }
  next();
}

export function requirePermission(...codes) {
  return (req, res, next) => {
    if (!req.session) {
      return res.status(401).json({ error: { code: 'unauthenticated', message: 'Cần đăng nhập.' } });
    }
    const granted = req.session.user.role === 'admin' ||
      codes.every((code) => req.session.permissions.includes(code));
    if (!granted) {
      return res.status(403).json({ error: { code: 'forbidden', message: 'Không có quyền thực hiện thao tác này.' } });
    }
    next();
  };
}

/** Kiểm tra Origin/Referer cho mọi request ghi dữ liệu. */
export function sameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  const referer = req.get('referer');
  const host = req.get('host');
  const allowed = new Set();
  if (origin) {
    try {
      allowed.add(new URL(origin).host);
    } catch {
      return res.status(403).json({ error: { code: 'bad_origin', message: 'Origin không hợp lệ.' } });
    }
  }
  if (!origin && referer) {
    try {
      allowed.add(new URL(referer).host);
    } catch {
      return res.status(403).json({ error: { code: 'bad_origin', message: 'Referer không hợp lệ.' } });
    }
  }
  if (allowed.size === 0) return next(); // client không phải trình duyệt; CSRF token vẫn bắt buộc
  if (!host || !allowed.has(host)) {
    return res.status(403).json({ error: { code: 'bad_origin', message: 'Yêu cầu khác origin bị từ chối.' } });
  }
  next();
}

export function requireCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const header = req.get('x-csrf-token');
  if (!req.session || !header || !safeEqual(header, req.session.csrf)) {
    return res.status(403).json({ error: { code: 'csrf_failed', message: 'CSRF token không hợp lệ hoặc đã hết hạn.' } });
  }
  next();
}

/**
 * Nhận diện lượt truy cập trang từ bên ngoài (tab mới, bookmark, gõ URL,
 * hoặc link từ site khác) để buộc đăng nhập lại dù cookie phiên vẫn còn.
 * Điều hướng nội bộ trong cùng site không bị hỏi lại.
 */
function isExternalNavigation(req) {
  if (!['GET', 'HEAD'].includes(req.method)) return false;
  if (String(req.get('sec-fetch-mode') || '').toLowerCase() !== 'navigate') return false;
  const site = String(req.get('sec-fetch-site') || '').toLowerCase();
  return site === 'none' || site === 'cross-site' || site === 'same-site';
}

/** Bảo vệ trang HTML khi bật SITE_REQUIRE_LOGIN. */
export function contentGate(req, res, next) {
  if (!config.requireLoginForContent) return next();
  if (req.session && !isExternalNavigation(req)) return next();
  const nextPath = encodeURIComponent(req.path);
  return res.redirect(302, `/login.html?next=${nextPath}`);
}

/** Chặn API dữ liệu công khai khi toàn bộ site yêu cầu đăng nhập. */
export function requireContentLogin(req, res, next) {
  if (!config.requireLoginForContent || req.session) return next();
  return res.status(401).json({
    error: { code: 'authentication_required', message: 'Cần đăng nhập để truy cập dữ liệu.' }
  });
}

export function requireAdminPage(req, res, next) {
  if (!req.session || isExternalNavigation(req)) {
    return res.redirect(302, `/login.html?next=${encodeURIComponent('/admin/')}`);
  }
  if (req.session.user.role !== 'admin') {
    return res.status(403).send('Chỉ quản trị viên được truy cập khu vực này.');
  }
  next();
}

export function notFound(req, res) {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: { code: 'not_found', message: 'Không tìm thấy endpoint.' } });
  }
  return res.status(404).type('html').send(
    '<!doctype html><html lang="vi"><meta charset="utf-8"><title>404</title>' +
    '<body style="font-family:system-ui;padding:3rem"><h1>404 — Không tìm thấy trang</h1>' +
    '<p><a href="/">Quay về trang chủ</a></p></body></html>'
  );
}

export function errorHandler(error, req, res, _next) {
  const status = error.status || 500;
  if (status >= 500) {
    console.error('[error]', req.method, req.originalUrl, error.stack || error.message);
  }
  if (res.headersSent) return;
  if (req.path.startsWith('/api/')) {
    return res.status(status).json({
      error: {
        code: error.code || 'internal_error',
        message: status >= 500 ? 'Lỗi máy chủ. Vui lòng thử lại sau.' : error.message,
        ...(error.details ? { details: error.details } : {})
      }
    });
  }
  res.status(status).type('text').send(status >= 500 ? 'Lỗi máy chủ.' : error.message);
}

export function intParam(value, fallback, { min = 0, max = 1000 } = {}) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function stringParam(value, max = 500) {
  return String(value == null ? '' : value).slice(0, max);
}
