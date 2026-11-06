import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function resolvePath(value, fallback) {
  const target = value && String(value).trim() ? String(value).trim() : fallback;
  return path.isAbsolute(target) ? target : path.join(ROOT, target);
}

export const config = {
  root: ROOT,
  env: process.env.NODE_ENV || 'development',
  host: process.env.HOST || '127.0.0.1',
  port: int(process.env.PORT, 8080),
  dbPath: resolvePath(process.env.DB_PATH, 'data/encyclopedia.db'),
  backupsDir: resolvePath(process.env.BACKUPS_DIR, 'backups'),
  sessionTtlHours: int(process.env.SESSION_TTL_HOURS, 8),
  cookieName: 'bk_session',
  secureCookie: bool(process.env.COOKIE_SECURE, process.env.NODE_ENV === 'production'),
  trustProxy: bool(process.env.TRUST_PROXY, false),
  requireLoginForContent: bool(process.env.SITE_REQUIRE_LOGIN, false),
  passwordPepper: process.env.PASSWORD_PEPPER || '',
  adminBootstrapPassword: process.env.ADMIN_BOOTSTRAP_PASSWORD || '',
  syncTimeoutMs: int(process.env.SYNC_TIMEOUT_MS, 30000),
  nvdSyncDays: int(process.env.NVD_SYNC_DAYS, 14),
  attackMaxTechniques: int(process.env.ATTACK_MAX_TECHNIQUES, 150),
  isProduction: (process.env.NODE_ENV || 'development') === 'production',
  apiKeys: {
    nvd: process.env.NVD_API_KEY || '',
    abusech: process.env.ABUSECH_AUTH_KEY || '',
    phishtank: process.env.PHISHTANK_APP_KEY || '',
    usdaFdc: process.env.USDA_FDC_API_KEY || '',
    openfda: process.env.OPENFDA_API_KEY || '',
    github: process.env.GITHUB_TOKEN || ''
  }
};

export const PAGES = [
  'index.html',
  'cybersecurity.html',
  'toxicology.html',
  'weapons.html',
  'safety.html',
  'glossary.html',
  'dashboard.html',
  'search.html',
  'sources.html',
  'chemical.html',
  'vulnerability.html',
  'article.html'
];
