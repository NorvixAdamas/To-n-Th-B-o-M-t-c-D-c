import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config/config.js';

let instance = null;
let schemaReady = false;

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadSchema() {
  return fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
}

export function getDb() {
  if (instance) return instance;
  ensureDir(config.dbPath);
  instance = new DatabaseSync(config.dbPath);
  instance.exec('PRAGMA foreign_keys = ON;');
  instance.exec('PRAGMA busy_timeout = 5000;');
  instance.exec('PRAGMA journal_mode = WAL;');
  if (!schemaReady) {
    instance.exec(loadSchema());
    schemaReady = true;
  }
  return instance;
}

export function closeDb() {
  if (instance) {
    try {
      instance.close();
    } catch {
      /* đã đóng */
    }
    instance = null;
    schemaReady = false;
  }
}

export function transaction(fn) {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(db);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* bỏ qua */
    }
    throw error;
  }
}

export function getOne(sql, params = []) {
  return getDb().prepare(sql).get(...params);
}

export function getAll(sql, params = []) {
  return getDb().prepare(sql).all(...params);
}

export function run(sql, params = []) {
  return getDb().prepare(sql).run(...params);
}

export function count(table, where = '1=1', params = []) {
  const row = getOne(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`, params);
  return row ? Number(row.n) : 0;
}

export function setting(key, fallback = null) {
  const row = getOne('SELECT value FROM site_settings WHERE setting_key = ?', [key]);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  run(
    `INSERT INTO site_settings (setting_key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(setting_key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value == null ? null : String(value), new Date().toISOString()]
  );
}
