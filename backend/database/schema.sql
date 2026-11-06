PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ============================================================
-- Người dùng, vai trò, quyền
-- ============================================================
CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  email TEXT,
  password_hash TEXT NOT NULL,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  is_active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  totp_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_secret TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT,
  ip TEXT,
  success INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_time ON login_attempts(created_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  details TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(created_at);

-- ============================================================
-- Nội dung học thuật
-- ============================================================
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  body TEXT NOT NULL DEFAULT '',
  domain TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  path TEXT,
  content_type TEXT NOT NULL DEFAULT 'editorial',
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'draft', 'archived')),
  source_url TEXT,
  verification_status TEXT NOT NULL DEFAULT 'editorial',
  data_origin TEXT NOT NULL DEFAULT 'editorial',
  license TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  locked INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  search_norm TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_articles_domain ON articles(domain);
CREATE INDEX IF NOT EXISTS idx_articles_search ON articles(search_norm);

CREATE TABLE IF NOT EXISTS glossary_terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  term TEXT NOT NULL,
  definition TEXT NOT NULL,
  domain TEXT NOT NULL,
  source_url TEXT,
  verification_status TEXT NOT NULL DEFAULT 'editorial',
  data_origin TEXT NOT NULL DEFAULT 'legacy',
  license TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  locked INTEGER NOT NULL DEFAULT 0,
  legacy_index INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  search_norm TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_glossary_unique ON glossary_terms(term, domain);
CREATE INDEX IF NOT EXISTS idx_glossary_search ON glossary_terms(search_norm);

CREATE TABLE IF NOT EXISTS chemicals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  common_names TEXT,
  cas_number TEXT,
  molecular_formula TEXT,
  molecular_weight REAL,
  iupac_name TEXT,
  category TEXT NOT NULL DEFAULT 'industrial',
  description TEXT,
  hazards TEXT,
  exposure_routes TEXT,
  health_effects TEXT,
  prevention TEXT,
  response TEXT,
  source_url TEXT,
  sources_json TEXT,
  pubchem_cid TEXT,
  verification_status TEXT NOT NULL DEFAULT 'curated',
  data_origin TEXT NOT NULL DEFAULT 'editorial',
  license TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  search_norm TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_chemicals_cas ON chemicals(cas_number);
CREATE INDEX IF NOT EXISTS idx_chemicals_search ON chemicals(search_norm);

CREATE TABLE IF NOT EXISTS vulnerabilities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cve_id TEXT UNIQUE NOT NULL,
  title TEXT,
  description TEXT,
  cvss_score REAL,
  cvss_severity TEXT,
  cvss_vector TEXT,
  epss_score REAL,
  epss_percentile REAL,
  epss_updated_at TEXT,
  cwe_ids TEXT,
  affected_products TEXT,
  remediation TEXT,
  known_exploited INTEGER NOT NULL DEFAULT 0,
  kev_added_at TEXT,
  kev_due_date TEXT,
  published_at TEXT,
  modified_at TEXT,
  source_url TEXT,
  data_origin TEXT NOT NULL DEFAULT 'nvd',
  verification_status TEXT NOT NULL DEFAULT 'verified',
  license TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  search_norm TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_vuln_score ON vulnerabilities(cvss_score);
CREATE INDEX IF NOT EXISTS idx_vuln_search ON vulnerabilities(search_norm);

CREATE TABLE IF NOT EXISTS threat_intel (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  tactic TEXT,
  technique_id TEXT,
  malware_family TEXT,
  indicator TEXT,
  severity TEXT,
  source TEXT NOT NULL,
  source_url TEXT,
  data_origin TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'verified',
  license TEXT,
  first_seen TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  search_norm TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_threat_unique ON threat_intel(external_id, source);
CREATE INDEX IF NOT EXISTS idx_threat_search ON threat_intel(search_norm);

CREATE TABLE IF NOT EXISTS food_safety (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'recall',
  product TEXT NOT NULL,
  reason TEXT,
  company TEXT,
  distribution TEXT,
  classification TEXT,
  country TEXT,
  recall_date TEXT,
  source TEXT NOT NULL,
  source_url TEXT,
  data_origin TEXT NOT NULL DEFAULT 'openfda',
  verification_status TEXT NOT NULL DEFAULT 'verified',
  license TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  search_norm TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_food_unique ON food_safety(external_id, source);
CREATE INDEX IF NOT EXISTS idx_food_search ON food_safety(search_norm);

CREATE TABLE IF NOT EXISTS foods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id TEXT NOT NULL,
  description TEXT NOT NULL,
  data_type TEXT,
  brand_owner TEXT,
  nutrients_json TEXT,
  source TEXT NOT NULL DEFAULT 'usda-fdc',
  source_url TEXT,
  verification_status TEXT NOT NULL DEFAULT 'verified',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  search_norm TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_foods_unique ON foods(external_id, source);

CREATE TABLE IF NOT EXISTS drug_reference (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id TEXT NOT NULL,
  brand_name TEXT,
  generic_name TEXT,
  warnings TEXT,
  food_effect TEXT,
  source TEXT NOT NULL DEFAULT 'openfda',
  source_url TEXT,
  verification_status TEXT NOT NULL DEFAULT 'verified',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  search_norm TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_drug_unique ON drug_reference(external_id, source);

CREATE TABLE IF NOT EXISTS research_articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  abstract TEXT,
  authors TEXT,
  journal TEXT,
  pub_date TEXT,
  source TEXT NOT NULL DEFAULT 'pubmed',
  source_url TEXT,
  verification_status TEXT NOT NULL DEFAULT 'verified',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  search_norm TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_research_unique ON research_articles(external_id, source);
CREATE INDEX IF NOT EXISTS idx_research_search ON research_articles(search_norm);

CREATE TABLE IF NOT EXISTS forensic_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  summary TEXT,
  year INTEGER,
  domain TEXT,
  findings TEXT,
  source_url TEXT,
  verification_status TEXT NOT NULL DEFAULT 'reference',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  search_norm TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS safety_protocols (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  steps_json TEXT,
  audience TEXT,
  source_url TEXT,
  verification_status TEXT NOT NULL DEFAULT 'reference',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  search_norm TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS legal_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_number TEXT NOT NULL,
  title TEXT NOT NULL,
  issuer TEXT,
  issued_year INTEGER,
  domain TEXT,
  summary TEXT,
  source_url TEXT,
  verification_status TEXT NOT NULL DEFAULT 'reference',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  search_norm TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS weapons_reference (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  recognition_markers TEXT,
  legal_note TEXT,
  handling_note TEXT,
  source_url TEXT,
  verification_status TEXT NOT NULL DEFAULT 'reference',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  search_norm TEXT NOT NULL DEFAULT ''
);

-- ============================================================
-- Nguồn dữ liệu, đồng bộ, cấu hình, bookmark
-- ============================================================
CREATE TABLE IF NOT EXISTS external_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT UNIQUE NOT NULL,
  number INTEGER,
  name TEXT NOT NULL,
  organization TEXT,
  category TEXT NOT NULL,
  url TEXT NOT NULL,
  api_endpoint TEXT,
  access_type TEXT NOT NULL DEFAULT 'reference',
  requires_key INTEGER NOT NULL DEFAULT 0,
  env_var TEXT,
  license TEXT,
  notes TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  connector TEXT,
  status TEXT NOT NULL DEFAULT 'never',
  last_sync_at TEXT,
  last_error TEXT,
  record_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_sync_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  fetched INTEGER NOT NULL DEFAULT 0,
  inserted INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  details TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_logs_time ON source_sync_logs(started_at);

CREATE TABLE IF NOT EXISTS site_settings (
  setting_key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  title TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, entity_type, entity_id)
);
