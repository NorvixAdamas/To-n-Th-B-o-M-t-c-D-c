# ENCYCLOPEDIA OF SECURITY AND TOXICOLOGY 2.0

**Bách khoa toàn thư về Bảo mật và Khoa học Độc học** — thư viện tri thức số tiếng Việt kết hợp
an ninh mạng, độc học, an toàn thực phẩm, pháp luật và nhận diện nguy cơ.

Phiên bản 2.0 **nâng cấp, không thay thế** phiên bản 1.0:

- Giữ nguyên toàn bộ 6 trang HTML cũ, 295 thuật ngữ, bài viết, bảng, case study và mục lục.
- Giữ nguyên Dark/Light Mode, Scrollspy, Reading Progress, Back to Top và bố cục gốc.
- Bổ sung backend Express thật, CSDL SQLite, tìm kiếm toàn văn, quản trị server-side và
  đồng bộ dữ liệu từ các nguồn công khai.

> Website phục vụ **giáo dục, nhận diện và phòng ngừa**. Không có hướng dẫn chế tạo chất độc,
> vũ khí, IED, liều gây chết hoặc thao tác gây hại. Xem [SECURITY.md](SECURITY.md).

---

## 1. Tính năng chính

| Nhóm | Chức năng |
| --- | --- |
| Thư viện | 6 chuyên khu cũ + bài viết biên tập mới, hồ sơ hóa chất, CVE, thuật ngữ |
| Tìm kiếm | Hợp nhất 11 loại dữ liệu, không dấu tiếng Việt, facet lĩnh vực/loại/nguồn/thời gian, gợi ý, phân trang |
| Dữ liệu | 32 nguồn khai báo, **15 connector thật**, 17 nguồn liên kết tham chiếu trung thực |
| Đồng bộ | Chạy tay hoặc theo lịch, retry/backoff, xử lý 429/timeout, lưu log, không ghi đè bản biên tập |
| Quản trị | Dashboard, CRUD nội dung, import JSON, quản lý người dùng, nguồn, audit, backup/restore |
| Bảo mật | bcrypt, session server HttpOnly, CSRF, CSP, rate limit, lockout, RBAC, TOTP, audit |
| Giao diện | Dashboard navy/emerald/cyan, dark/light, responsive, print, accessibility, reduced motion |

### Dữ liệu đã có sau khi cài

- **295** thuật ngữ (parse nguyên văn từ `glossary.html`, không sửa file gốc).
- **18** hồ sơ hóa chất có nguồn; **8** lỗ hổng mẫu; **7** bài viết biên tập.
- **32** nguồn dữ liệu; **7** văn bản pháp luật; **10** quy trình an toàn; **6** case study.
- Sau đồng bộ thực tế (máy tham chiếu): **1.768 CVE** từ CISA KEV, **1.768** điểm EPSS,
  **18** hồ sơ PubChem, **99** cảnh báo thu hồi thực phẩm openFDA.

---

## 2. Kiến trúc

```
webhack/
├── index.html … glossary.html        # 6 trang gốc — KHÔNG sửa nội dung
├── dashboard.html, search.html       # giao diện 2.0
├── sources.html, chemical.html
├── vulnerability.html, article.html
├── login.html
├── admin/index.html
├── css/  styles.css, v2.css, admin.css
├── js/   app.js (gốc), core.js, dashboard.js, search.js,
│         sources.js, record.js, login.js, admin.js, admin-content.js
├── backend/
│   ├── server.js                     # Express 5, static allowlist, mount API
│   ├── config/config.js              # đọc env, không chứa bí mật
│   ├── database/                     # schema.sql, db.js, seed.js, legacy-import.js
│   ├── auth/security.js              # bcrypt, session, CSRF, TOTP, RBAC
│   ├── middleware/http.js            # CSP, rate limit, origin, auth, lỗi
│   ├── api/ public.js, auth.js, admin.js
│   ├── services/ search.js, stats.js, sync.js, admin.js
│   └── integrations/                 # http client + 15 connector
├── data/  seed/*.json, encyclopedia.db (sinh tự động, không commit)
├── scripts/ bootstrap-admin.js, sync.js, backup.js, restore.js
├── tests/ api.test.js
├── backups/
├── .env.example
├── README.md
└── SECURITY.md
```

**Stack:** Node.js (ESM) · Express 5 · `node:sqlite` (built-in) · `bcryptjs` · HTML/CSS/JS thuần.
Không dùng framework frontend, không cần build bước CSS/JS.

Yêu cầu: **Node.js ≥ 24** (khuyến nghị 26 LTS trở lên; đã kiểm thử với Node v26.13.0).
`node:sqlite` là module built-in nên không cần cài SQLite native.

---

## 3. Cài đặt nhanh

```bash
# 1. Cài dependency
npm install

# 2. Tạo cấu hình
cp .env.example .env        # Windows: copy .env.example .env
#    Sửa SESSION_SECRET, PASSWORD_PEPPER, COOKIE_SECURE… (xem bảng dưới)

# 3. Khởi tạo CSDL + dữ liệu (idempotent, không xóa dữ liệu đã có)
npm run seed

# 4. Tạo admin một lần, mật khẩu do bạn chọn (≥12 ký tự, hoa/thường/số)
#    Linux/macOS:
ADMIN_BOOTSTRAP_PASSWORD='Mật-Khẩu-Mạnh-Của-Bạn' npm run bootstrap
#    PowerShell:
$env:ADMIN_BOOTSTRAP_PASSWORD='Mật-Khẩu-Mạnh-Của-Bạn'; npm run bootstrap

# 5. Chạy
npm start
# → http://127.0.0.1:8099
```

Mật khẩu bootstrap **chỉ** đọc từ biến môi trường, không ghi vào HTML/JS/README/CSDL dạng thô.
Tài khoản tạo bằng bootstrap bị buộc đổi mật khẩu ở lần đăng nhập đầu tiên.

### Biến môi trường

| Biến | Mặc định | Ghi chú |
| --- | --- | --- |
| `PORT` / `HOST` | `8099` / `127.0.0.1` | Đổi `HOST=0.0.0.0` khi chạy trong container |
| `NODE_ENV` | `development` | `production` bật kiểm tra cookie secure |
| `DB_PATH` | `data/encyclopedia.db` | Đường dẫn SQLite |
| `SESSION_SECRET` | sinh ngẫu nhiên | **Bắt buộc đặt cố định ở production** |
| `PASSWORD_PEPPER` | rỗng | Chuỗi bí mật thêm vào bcrypt; đổi sẽ vô hiệu hóa mật khẩu cũ |
| `SESSION_TTL_HOURS` | `8` | Thời hạn phiên |
| `COOKIE_SECURE` | theo env | `true` khi chạy HTTPS |
| `TRUST_PROXY` | `false` | `true` sau reverse proxy tin cậy |
| `SITE_REQUIRE_LOGIN` | `true` | Bắt buộc đăng nhập cho mọi trang và API dữ liệu |
| `ADMIN_BOOTSTRAP_PASSWORD` | — | Chỉ dùng cho `npm run bootstrap` |
| `NVD_API_KEY` | — | Tăng hạn mức NVD (không bắt buộc) |
| `ABUSECH_AUTH_KEY` | — | URLhaus / ThreatFox / MalwareBazaar |
| `PHISHTANK_APP_KEY` | — | PhishTank |
| `OPENFDA_API_KEY` | — | Tăng hạn mức openFDA |
| `USDA_FDC_API_KEY` | — | FoodData Central |

Không commit `.env`. File `.env.example` chỉ chứa tên biến và hướng dẫn.

---

## 4. Nguồn dữ liệu (32)

### Nhóm A — An ninh mạng (12)

| # | Nguồn | Cách tích hợp |
| --- | --- | --- |
| 1 | NVD | Connector API 2.0, tra CVE, CVSS, CWE |
| 2 | CISA KEV | Connector JSON, đã đồng bộ 1.768 CVE |
| 3 | MITRE ATT&CK | Connector STIX từ GitHub |
| 4 | MITRE CWE | Connector XML/JSON |
| 5 | MITRE CAPEC | Liên kết tham chiếu (API công khai không ổn định) |
| 6 | FIRST EPSS | Connector CSV/API theo CVE |
| 7 | OSV.dev | Connector API truy vấn gói |
| 8 | GitHub Advisories | Liên kết tham chiếu (cần token cho hạn mức cao) |
| 9 | PhishTank | Connector cần `PHISHTANK_APP_KEY` |
| 10 | URLhaus | Connector cần `ABUSECH_AUTH_KEY` |
| 11 | ThreatFox | Connector cần `ABUSECH_AUTH_KEY` |
| 12 | MalwareBazaar | Connector chỉ lưu băm/nhãn, **không tải mẫu** |

### Nhóm B — Hóa học & độc học (11)

| # | Nguồn | Cách tích hợp |
| --- | --- | --- |
| 13 | PubChem | Connector PUG REST; 18 hồ sơ đã cập nhật |
| 14 | EPA CompTox | Liên kết tham chiếu |
| 15 | EPA ToxCast | Liên kết tham chiếu |
| 16 | EPA ToxValDB | Liên kết tham chiếu |
| 17 | EPA ECOTOX | Liên kết tham chiếu |
| 18 | NIOSH Pocket Guide | Liên kết tham chiếu |
| 19 | ILO-WHO ICSC | Liên kết tham chiếu |
| 20 | NOAA CAMEO | Liên kết tham chiếu |
| 21 | ECHA CHEM | Liên kết tham chiếu |
| 22 | ATSDR ToxFAQs | Liên kết tham chiếu |
| 23 | NCBI PubMed | Connector E-utilities |

### Nhóm C — Thực phẩm & y khoa (4)

| # | Nguồn | Cách tích hợp |
| --- | --- | --- |
| 24 | openFDA Food Enforcement | Connector, đã lấy 99 cảnh báo |
| 25 | openFDA Drug | Connector |
| 26 | USDA FoodData Central | Connector cần `USDA_FDC_API_KEY` |
| 27 | FoodSafety.gov | Liên kết tham chiếu |

### Nhóm D — Vũ khí, hàng cấm & an toàn công cộng (5)

| # | Nguồn | Cách tích hợp |
| --- | --- | --- |
| 28 | CSDL quốc gia về pháp luật (vbpl.vn) | Liên kết tham chiếu + văn bản biên tập |
| 29 | Công báo Chính phủ | Liên kết tham chiếu |
| 30 | UNODC Firearms Protocol | Liên kết tham chiếu |
| 31 | CISA Bomb Threat Guidance | Liên kết tham chiếu |
| 32 | INTERPOL IFRT | **Chỉ liên kết** — truy cập giới hạn cho cơ quan có thẩm quyền |

**Trung thực dữ liệu:** nguồn “tham chiếu” không được tính là đã đồng bộ. Connector thiếu API key
được đánh dấu `key_required`; lỗi được ghi vào `source_sync_logs` kèm thông điệp, không hiển thị
“thành công” giả. Các nguồn có điều khoản hạn chế (INTERPOL, iARMS) chỉ được liên kết công khai.

### Đồng bộ dữ liệu

```bash
npm run sync                      # tất cả nguồn đang bật và có connector
npm run sync -- cisa-kev epss     # chọn nguồn cụ thể
npm run sync -- --list            # xem khóa nguồn hợp lệ
```

Admin → **Nguồn dữ liệu & đồng bộ** cho phép bật/tắt nguồn, chạy đồng bộ và xem log.
Connector có timeout, retry có giới hạn, xử lý 429; dữ liệu trùng được bỏ qua theo khóa tự nhiên.

---

## 5. API chính

| Method | Đường dẫn | Mô tả |
| --- | --- | --- |
| GET | `/api/health` | Trạng thái server |
| GET | `/api/stats` | Thống kê dashboard |
| GET | `/api/search?q=&domain=&type=&from=&to=&sort=&page=` | Tìm kiếm hợp nhất |
| GET | `/api/glossary?q=&domain=` | Thuật ngữ |
| GET | `/api/chemicals?q=` | Danh sách hóa chất |
| GET | `/api/chemicals/:idOrCasOrName` | Hồ sơ hóa chất (id, CAS, tên hoặc tên đồng nghĩa) |
| GET | `/api/vulnerabilities?q=&severity=` | Danh sách lỗ hổng |
| GET | `/api/vulnerabilities/:cve` | Chi tiết CVE |
| GET | `/api/articles/:slug` | Bài viết (Markdown đã render an toàn) |
| GET | `/api/sources`, `/api/sources/logs` | Nguồn và lịch sử đồng bộ |
| POST | `/api/auth/login`, `/api/auth/logout` | Đăng nhập/đăng xuất |
| GET | `/api/auth/me` | Phiên hiện tại + CSRF token |
| POST | `/api/auth/change-password` | Đổi mật khẩu |
| POST | `/api/auth/totp/setup|enable|disable` | Quản lý TOTP |
| GET/POST/PATCH/DELETE | `/api/admin/articles…` | CRUD bài viết |
| GET/POST/PATCH/DELETE | `/api/admin/glossary…`, `/api/admin/chemicals…` | CRUD dữ liệu |
| POST | `/api/admin/import` | Nhập JSON (≤500 bản ghi) |
| POST | `/api/admin/sync`, GET `/api/admin/sync/:id` | Chạy và theo dõi đồng bộ |
| GET/POST/PATCH | `/api/admin/users…` | Người dùng, vai trò, reset mật khẩu |
| GET | `/api/admin/audit`, `/api/admin/backups` | Nhật ký, sao lưu |
| POST | `/api/admin/backup` | Tạo bản sao lưu có kiểm tra integrity |

Mọi thao tác ghi yêu cầu cookie phiên + header `x-csrf-token`. API quản trị yêu cầu vai trò phù hợp.

---

## 6. Quản trị

- Toàn bộ trang và API dữ liệu bị chặn nếu chưa đăng nhập; `/admin/` yêu cầu vai trò `admin`.
- Dashboard: số bài viết, hóa chất, thuật ngữ, CVE, nguồn, người dùng, lần đồng bộ, nguồn lỗi.
- Nội dung: bài viết (Markdown), thuật ngữ, hóa chất, import JSON.
- Nguồn: trạng thái, bật/tắt, đồng bộ từng nguồn hoặc tất cả, log lỗi.
- Người dùng: tạo, đổi vai trò (`admin`/`editor`/`viewer`), khóa, reset mật khẩu.
- Bảo mật: đổi mật khẩu, bật/tắt TOTP, tạo và xem bản sao lưu.
- Cấu hình: tiêu đề/mô tả website.
- Audit log ghi hành động quản trị, IP, thời gian, đối tượng.

Bootstrap admin chỉ tạo khi CSDL chưa có user `admin`; chạy lại sẽ không ghi đè.

---

## 7. Kiểm thử

```bash
npm test
```

Bộ test dùng CSDL tạm trong thư mục temp, không chạm dữ liệu thật. Kết quả tham chiếu: **14/14 pass**.

Đã kiểm tra: seed 295 thuật ngữ/32 nguồn; trang cũ và glossary nguyên vẹn; chặn truy cập
`backend/`, `.env`, CSDL; tìm kiếm không dấu; SQL injection; header CSP/frame; chặn origin lạ;
admin API chưa đăng nhập → 401; đăng nhập sai → 401; cookie HttpOnly; thiếu CSRF → 403;
RBAC viewer không ghi được; Markdown escape `<script>`; tạo backup integrity `ok`.

Kiểm tra thủ công bổ sung: dark/light, responsive, scrollspy, reading progress trên các trang gốc;
luồng đổi mật khẩu bắt buộc; đồng bộ KEV/EPSS/PubChem/openFDA thật.

---

## 8. Sao lưu & khôi phục

```bash
npm run backup                    # → backups/encyclopedia-<timestamp>.db
npm run restore -- backups/<file>.db --yes   # DỪNG server trước khi restore
```

Backup dùng `VACUUM INTO` + `PRAGMA integrity_check`. Restore tự sao lưu CSDL hiện tại trước khi ghi đè.
Có thể tạo backup từ Admin → Bảo mật.

---

## 9. Triển khai

1. Đặt sau reverse proxy HTTPS (Nginx/Caddy), `TRUST_PROXY=true`, `COOKIE_SECURE=true`.
2. `NODE_ENV=production`, `SESSION_SECRET` và `PASSWORD_PEPPER` ngẫu nhiên, `.env` quyền `600`.
3. Chạy bằng systemd/PM2, chỉ mở cổng nội bộ; giới hạn `/admin/` theo IP/VPN nếu có.
4. Seed + bootstrap một lần; bật TOTP; tạo tài khoản editor/viewer riêng.
5. Sao lưu định kỳ ra ngoài máy chủ; theo dõi audit và sync log.
6. SQLite phù hợp một instance; đa instance cần PostgreSQL + session store ngoài.

Chi tiết mô hình đe dọa, CSRF, CSP, xử lý sự cố: [SECURITY.md](SECURITY.md).

---

## 10. Giới hạn & miễn trừ

- Dữ liệu bên thứ ba có thể lỗi thời hoặc thiếu; trạng thái đồng bộ chỉ phản ánh lần chạy gần nhất.
- Nguồn tham chiếu không được tải toàn bộ; một số nguồn cần API key hoặc quyền truy cập riêng.
- Nội dung y tế/pháp lý mang tính tham khảo, **không thay thế bác sĩ, luật sư hoặc cơ quan chức năng**.
- Không có hướng dẫn chế tạo, liều gây chết, bản vẽ IED hay cải tạo vũ khí.
- Rate limit hiện lưu trong bộ nhớ; chống DDoS cần WAF/tầng ngoài.
- **Chế độ tĩnh/Netlify:** login chạy bằng JavaScript và chỉ che giao diện, không bảo vệ
  nội dung trong file nguồn. Các trang 2.0 cần API/CSDL vẫn phải chạy trên server.
- Bản quyền dữ liệu thuộc về từng nguồn; khi tái sử dụng phải tuân thủ điều khoản của nguồn đó.

## 11. Lịch sử phiên bản

- **2.0** — backend/CSDL, tìm kiếm hợp nhất, 15 connector, admin server-side, TOTP, audit, backup,
  giao diện dashboard và các trang hồ sơ; giữ nguyên toàn bộ nội dung 1.0.
- **1.0** — website tĩnh 6 chuyên khu, 295 thuật ngữ, dark/light, scrollspy.
