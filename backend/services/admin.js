import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/config.js';
import { getDb, getOne, getAll, run } from '../database/db.js';
import { HttpError } from '../middleware/http.js';

export function recordAudit(req, action, { entityType = null, entityId = null, details = null } = {}) {
  try {
    run(
      `INSERT INTO audit_logs (user_id, actor, action, entity_type, entity_id, details, ip, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.session?.user?.id || null,
        req.session?.user?.username || 'anonymous',
        action,
        entityType,
        entityId ? String(entityId) : null,
        details ? JSON.stringify(details) : null,
        req.ip || null,
        String(req.get('user-agent') || '').slice(0, 300),
        new Date().toISOString()
      ]
    );
  } catch (error) {
    console.error('[audit] không ghi được log:', error.message);
  }
}

export function listAudit({ limit = 50, offset = 0 } = {}) {
  return getAll(
    `SELECT a.*, COALESCE(a.actor, u.username) AS actor_name FROM audit_logs a
     LEFT JOIN users u ON u.id = a.user_id ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
    [limit, offset]
  );
}

function ensureBackupDir() {
  if (!fs.existsSync(config.backupsDir)) fs.mkdirSync(config.backupsDir, { recursive: true });
}

export function createBackup(label = 'manual') {
  ensureBackupDir();
  const safeLabel = String(label).replace(/[^a-z0-9_-]/gi, '').slice(0, 30) || 'manual';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `encyclopedia-${stamp}-${safeLabel}.db`;
  const target = path.join(config.backupsDir, filename);
  if (fs.existsSync(target)) throw new HttpError(409, 'backup_exists', 'Bản sao lưu đã tồn tại.');
  const db = getDb();
  const statement = db.prepare('VACUUM INTO ?');
  statement.run(target);
  const stat = fs.statSync(target);
  if (!stat.size) throw new HttpError(500, 'backup_failed', 'Bản sao lưu rỗng.');
  const checkDb = new (db.constructor)(target);
  const integrity = checkDb.prepare('PRAGMA integrity_check').get();
  checkDb.close();
  return {
    filename,
    size: stat.size,
    createdAt: stat.mtime.toISOString(),
    integrity: integrity ? Object.values(integrity)[0] : 'unknown'
  };
}

export function listBackups() {
  ensureBackupDir();
  return fs.readdirSync(config.backupsDir)
    .filter((name) => name.endsWith('.db'))
    .map((name) => {
      const stat = fs.statSync(path.join(config.backupsDir, name));
      return { filename: name, size: stat.size, createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function latestBackup() {
  return listBackups()[0] || null;
}

export function dbInfo() {
  const page = getOne('PRAGMA page_count') || {};
  const size = getOne('PRAGMA page_size') || {};
  return {
    path: config.dbPath,
    sizeBytes: Number(Object.values(page)[0] || 0) * Number(Object.values(size)[0] || 0)
  };
}
