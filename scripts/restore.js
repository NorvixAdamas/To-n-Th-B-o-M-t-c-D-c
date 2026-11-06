import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../backend/config/config.js';

const args = process.argv.slice(2);
const fileArg = args.find((arg) => !arg.startsWith('-'));
const confirmed = args.includes('--yes');

if (!fileArg) {
  console.error('Dùng: npm run restore -- backups/<ten-file>.db --yes');
  process.exit(1);
}

const candidate = path.resolve(config.backupsDir, path.basename(fileArg));
if (!candidate.startsWith(path.resolve(config.backupsDir) + path.sep)) {
  console.error('Chỉ được khôi phục từ thư mục backups/.');
  process.exit(1);
}
if (!fs.existsSync(candidate)) {
  console.error('Không tìm thấy bản sao lưu:', candidate);
  process.exit(1);
}
if (!confirmed) {
  console.error('Khôi phục sẽ GHI ĐÈ CSDL hiện tại. Dừng server trước, sau đó thêm cờ --yes để xác nhận.');
  process.exit(1);
}

const check = new DatabaseSync(candidate);
const integrity = check.prepare('PRAGMA integrity_check').get();
check.close();
if (!integrity || Object.values(integrity)[0] !== 'ok') {
  console.error('Bản sao lưu không toàn vẹn, hủy khôi phục.');
  process.exit(1);
}

if (fs.existsSync(config.dbPath)) {
  const safety = `${config.dbPath}.before-restore-${Date.now()}`;
  fs.copyFileSync(config.dbPath, safety);
  console.log('Đã lưu bản CSDL hiện tại tại:', safety);
}
fs.copyFileSync(candidate, config.dbPath);
console.log('Đã khôi phục CSDL từ:', path.basename(candidate));
console.log('Khởi động lại server và đăng nhập để kiểm tra dữ liệu.');
