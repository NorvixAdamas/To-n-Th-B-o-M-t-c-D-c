# SECURITY — Bách Khoa Bảo Mật & Độc Học 2.0

Tài liệu này mô tả cơ chế bảo vệ thực tế của phiên bản 2.0, những gì **chưa** được bảo vệ và
cách vận hành an toàn. Website là học liệu công khai, không phải hệ thống lưu trữ dữ liệu mật.

## 1. Mô hình đe dọa

| Tài sản | Nguy cơ chính | Kiểm soát |
| --- | --- | --- |
| Tài khoản quản trị | Chiếm phiên, brute-force, CSRF, XSS | bcrypt cost 12, session HttpOnly, CSRF token, rate limit, khóa tạm, TOTP |
| Nội dung/CSDL | Sửa trái phép, SQL injection, mất dữ liệu | Truy vấn tham số hóa, RBAC, audit log, backup |
| API key nguồn dữ liệu | Lộ key, lạm dụng hạn mức | Chỉ đọc từ biến môi trường phía server, không gửi ra client |
| Máy chủ tĩnh | Lộ source, `.env`, CSDL | Allowlist thư mục tĩnh, chặn `backend/`, `data/`, dotfiles |
| Người đọc | Nội dung gây hại, XSS qua nhập liệu | Markdown escape HTML, CSP chặt, không render HTML thô của người dùng |

**Không nằm trong phạm vi:** chống DDoS quy mô lớn, mã hóa CSDL at-rest, xác thực email,
SSO doanh nghiệp, tuân thủ pháp lý chuyên biệt (HIPAA/PCI…). Cần bổ sung khi triển khai thật.

## 2. Xác thực & phiên

- Mật khẩu băm bằng **bcrypt** (cost 12), có thể thêm `PASSWORD_PEPPER` phía server.
  Đổi pepper sẽ làm toàn bộ mật khẩu cũ không xác thực được — phải đổi đồng thời.
- Phiên lưu **phía server** trong bảng `sessions`; cookie `bk_session` có `HttpOnly`,
  `SameSite=Strict`, `Secure` khi HTTPS (bật `COOKIE_SECURE=true`), hết hạn sau 8 giờ mặc định.
- Mỗi lượt mở trang từ ngoài (tab mới, bookmark, gõ URL hoặc link từ site khác) yêu cầu
  đăng nhập lại ngay cả khi cookie phiên cũ còn hiệu lực; điều hướng nội bộ trong cùng
  phiên không hỏi lại. `/login.html` luôn hiển thị form, không tự chuyển hướng.
- Token phiên ngẫu nhiên 32 byte; CSDL chỉ lưu **SHA-256** của token.
- Đăng xuất thu hồi phiên; đổi mật khẩu thu hồi các phiên khác.
- Đăng nhập sai 5 lần → khóa tạm 15 phút; giới hạn tần suất theo IP + username.
- Bootstrap admin chỉ chạy một lần từ `ADMIN_BOOTSTRAP_PASSWORD`; **không** lưu mật khẩu
  trong mã nguồn. Tài khoản bị buộc đổi mật khẩu ở lần đăng nhập đầu.
- TOTP (RFC 6238) hỗ trợ bật/tắt trong trang quản trị. Bí mật TOTP lưu trong CSDL;
  không có mã dự phòng tự động — cần quy trình khôi phục thủ công nếu mất thiết bị.

> Cổng đăng nhập client-side của phiên bản 1.0 đã bị loại bỏ. Quyền quản trị **chỉ** dựa trên
> phiên server và kiểm tra RBAC ở từng API. Không dùng `sessionStorage` làm bằng chứng xác thực.
>
> Khi `SITE_REQUIRE_LOGIN=true`, `contentGate` chặn mọi trang HTML và `requireContentLogin`
> chặn toàn bộ API dữ liệu công khai; chỉ `/login.html`, `/api/auth/login` và `/healthz` là ngoại lệ.

## 3. Phân quyền (RBAC)

| Vai trò | Quyền chính |
| --- | --- |
| `admin` | Toàn bộ, kể cả người dùng, audit, backup, cấu hình |
| `editor` | Đọc/ghi bài viết, thuật ngữ, hóa chất; bật/tắt nguồn; chạy đồng bộ |
| `viewer` | Chỉ đọc API quản trị |

- Mọi API `/api/admin/*` đều qua `requireAuth` + `requirePermission`.
- Không thể tự hạ quyền hoặc tự khóa tài khoản đang đăng nhập.
- Tài khoản bị vô hiệu hóa sẽ bị thu hồi phiên ngay.

## 4. CSRF, CORS và header

- Mọi thao tác ghi yêu cầu header `x-csrf-token` khớp bí mật của phiên (so sánh timing-safe).
- Kiểm tra `Origin`/`Referer` cùng host cho request ghi; origin lạ bị `403`.
- Không bật CORS: trình duyệt khác origin không đọc được API.
- CSP: `default-src 'self'`, không inline script, `object-src 'none'`, `frame-ancestors 'none'`.
- Header bổ sung: `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`,
  `Permissions-Policy`, COOP/CORP, HSTS khi HTTPS.
- Giới hạn kích thước JSON 1 MB; giới hạn tần suất API 600 request/phút/IP.

## 5. Chống injection và XSS

- Mọi truy vấn dùng tham số `?` của `node:sqlite`, không nối chuỗi từ đầu vào.
- API tìm kiếm chuẩn hóa từ khóa, giới hạn độ dài, không dùng input làm SQL.
- Bài viết biên tập lưu Markdown; server **escape HTML trước** khi render, chỉ cho phép
  liên kết `http/https`, không render thẻ thô. Tiêu đề/định nghĩa hiển thị qua `textContent`
  hoặc escape ở client.
- Không có upload tệp thực thi; import JSON giới hạn 500 bản ghi, không chạy mã.

## 6. Nguồn dữ liệu và API key

- Connector chỉ gọi endpoint cố định (không nhận URL từ người dùng) → giảm rủi ro SSRF.
- API key đọc từ biến môi trường (`NVD_API_KEY`, `ABUSECH_AUTH_KEY`, `PHISHTANK_APP_KEY`,
  `USDA_FDC_API_KEY`, `OPENFDA_API_KEY`); không gửi xuống trình duyệt, không ghi log.
- Nguồn cần key sẽ bị đánh dấu `key_required` và **không** đồng bộ nếu thiếu key.
- Nguồn giới hạn quyền (INTERPOL IFRT) chỉ liên kết công khai; không vượt kiểm soát truy cập.
- Connector MalwareBazaar chỉ lưu mã băm/nhãn, **không tải mẫu**.
- Trạng thái “đã đồng bộ” chỉ là kết quả lần chạy gần nhất, không phải cam kết dữ liệu đầy đủ.

## 7. Dữ liệu và sao lưu

- CSDL SQLite tại `data/encyclopedia.db` (WAL). Không phục vụ qua HTTP.
- `npm run backup` hoặc nút trong admin tạo bản sao bằng `VACUUM INTO`, kiểm tra
  `PRAGMA integrity_check`.
- Khôi phục: **dừng server**, chạy `npm run restore -- backups/<file>.db --yes`.
  Script tự lưu bản CSDL hiện tại trước khi ghi đè.
- Nên mã hóa ổ đĩa và giới hạn quyền truy cập thư mục dự án trên máy chủ.

## 8. Triển khai production — checklist

1. `NODE_ENV=production`, HTTPS bắt buộc, đặt sau reverse proxy tin cậy và `TRUST_PROXY=true`.
2. `COOKIE_SECURE=true`, `PASSWORD_PEPPER` ngẫu nhiên, `.env` quyền hạn chế, không commit.
3. Chạy `npm run bootstrap` với mật khẩu mạnh do chủ sở hữu cung cấp; đổi ngay khi đăng nhập.
4. Bật TOTP cho admin; tạo tài khoản editor/viewer riêng, không dùng chung.
5. Cấu hình firewall, giới hạn `/admin/` theo IP/VPN nếu có thể; bật backup định kỳ ngoài máy chủ.
6. Theo dõi `audit_logs`, `source_sync_logs`, dung lượng đĩa và lỗi 5xx.
7. Cập nhật dependency (`npm audit`) và Node.js; chạy lại `npm test` sau thay đổi.
8. Rate limit hiện lưu **trong bộ nhớ**: nhiều instance cần Redis/WAF ở tầng ngoài.

## 9. Giới hạn đã biết

- Rate limit và khóa đăng nhập một phần dựa trên bộ nhớ tiến trình; restart sẽ xóa bộ đếm
  trong bộ nhớ (bộ đếm `failed_attempts` trong CSDL vẫn còn).
- SQLite phù hợp một instance; đa instance cần PostgreSQL và session store ngoài.
- Không có quy trình “quên mật khẩu” qua email; admin phải đặt lại qua tài khoản admin khác
  hoặc thao tác CSDL có kiểm soát.
- TOTP không có mã dự phòng; mất thiết bị cần can thiệp thủ công.
- Nội dung y tế/pháp lý không thay thế chuyên gia; dữ liệu bên thứ ba có thể lỗi thời.
- Website không bảo đảm chống DDoS, không có WAF tích hợp.

## 10. Báo cáo lỗ hổng

Đây là dự án học liệu cục bộ. Nếu triển khai công khai, hãy tạo kênh liên hệ bảo mật riêng
(ví dụ `security@…`) và không công bố chi tiết khai thác trước khi có bản vá. Không đưa
thông tin đăng nhập, API key hoặc dữ liệu cá nhân vào issue công khai.

## 11. Chế độ tĩnh / Netlify (fallback)

Khi deploy chỉ HTML/CSS/JS, `js/static-auth.js` phát hiện không có `/api/auth/me` và dùng
salt + SHA-256 digest trong trình duyệt, lưu phiên trong `sessionStorage`. Đây **không phải**
kiểm soát truy cập an toàn:

- Nội dung tĩnh vẫn nằm trong file nguồn; có thể đọc trực tiếp hoặc bỏ qua JavaScript.
- Người biết hoặc brute-force được digest có thể tạo phiên; không dùng cho dữ liệu mật.
- Bản chạy Express vẫn dùng session server, bcrypt, CSRF và RBAC như mô tả; fallback chỉ
  được kích hoạt khi API không tồn tại.
- Digest tĩnh được tạo từ tài khoản hiện tại; đổi mật khẩu trên server không tự cập nhật
  digest tĩnh. Cần tạo lại digest khi đổi mật khẩu.
- Các trang 2.0 cần API/CSDL (dashboard, tìm kiếm hợp nhất, quản trị) không hoạt động
  trên host tĩnh; chỉ nội dung 1.0 và form login là dùng được.
