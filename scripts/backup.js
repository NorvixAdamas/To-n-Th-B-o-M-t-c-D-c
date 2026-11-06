import { createBackup, listBackups } from '../backend/services/admin.js';

try {
  const backup = createBackup('cli');
  console.log('Đã tạo bản sao lưu:', backup.filename);
  console.log(`Kích thước: ${(backup.size / 1024).toFixed(1)} KB · Toàn vẹn: ${backup.integrity}`);
  console.log(`Tổng số bản sao lưu: ${listBackups().length}`);
} catch (error) {
  console.error('Sao lưu thất bại:', error.message);
  process.exit(1);
}
