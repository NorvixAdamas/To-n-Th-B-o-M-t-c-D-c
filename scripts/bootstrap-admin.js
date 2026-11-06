import { config } from '../backend/config/config.js';
import { getOne, run } from '../backend/database/db.js';
import { seedDatabase } from '../backend/database/seed.js';
import { hashPassword, validatePasswordStrength } from '../backend/auth/security.js';

const password = config.adminBootstrapPassword;
const username = 'admin';

if (!password) {
  console.error('Thiếu ADMIN_BOOTSTRAP_PASSWORD. Hãy đặt biến này trong .env hoặc môi trường chạy lệnh.');
  process.exit(1);
}

const weak = validatePasswordStrength(password);
if (weak) {
  console.error(`Mật khẩu bootstrap không đạt yêu cầu: ${weak}`);
  process.exit(1);
}

seedDatabase({ quiet: true });

const existing = getOne('SELECT id FROM users WHERE username = ?', [username]);
if (existing) {
  console.log('Tài khoản admin đã tồn tại. Không tạo lại và không ghi đè mật khẩu.');
  console.log('Nếu cần đặt lại, hãy đăng nhập bằng tài khoản admin hiện có hoặc dùng quy trình khôi phục có kiểm soát.');
  process.exit(0);
}

const role = getOne("SELECT id FROM roles WHERE name = 'admin'");
if (!role) {
  console.error('Không tìm thấy vai trò admin. Chạy npm run seed trước.');
  process.exit(1);
}

const hash = await hashPassword(password);
const timestamp = new Date().toISOString();
run(
  `INSERT INTO users (username, email, password_hash, role_id, is_active, must_change_password, created_at, updated_at)
   VALUES (?, NULL, ?, ?, 1, 1, ?, ?)`,
  [username, hash, role.id, timestamp, timestamp]
);

run(
  `INSERT INTO audit_logs (user_id, actor, action, entity_type, entity_id, details, ip, user_agent, created_at)
   VALUES ((SELECT id FROM users WHERE username = ?), 'system', 'admin_bootstrapped', 'user', NULL, ?, NULL, 'cli', ?)`,
  [username, JSON.stringify({ mustChangePassword: true }), timestamp]
);

console.log('Đã tạo tài khoản quản trị: admin');
console.log('Mật khẩu lấy từ ADMIN_BOOTSTRAP_PASSWORD và KHÔNG được in ra.');
console.log('Lần đăng nhập đầu tiên bắt buộc đổi mật khẩu.');
