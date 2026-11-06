(function () {
  'use strict';
  var BK = window.BK;
  var state = { me: null, csrf: null, view: 'overview', syncTimer: null };
  var VIEW_TITLES = {
    overview: 'Tổng quan hệ thống',
    content: 'Quản lý nội dung',
    sources: 'Nguồn dữ liệu & đồng bộ',
    users: 'Người dùng & phân quyền',
    audit: 'Nhật ký hoạt động',
    security: 'Bảo mật & sao lưu',
    settings: 'Cấu hình website'
  };

  function esc(value) {
    return BK.escapeHtml(value);
  }

  function api(path, options) {
    var config = Object.assign({}, options || {});
    config.headers = Object.assign({}, config.headers || {});
    if (config.method && config.method !== 'GET') config.headers['x-csrf-token'] = state.csrf;
    return BK.api(path, config).catch(function (error) {
      if (error.code === 'password_change_required') {
        showPasswordBanner();
        if (state.view !== 'security') navigate('security');
      }
      throw error;
    });
  }

  function showPasswordBanner() {
    document.getElementById('password-banner').hidden = false;
  }

  function openModal(title, body, footer) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = body;
    document.getElementById('modal-foot').innerHTML = footer || '<button class="v2-btn" type="button" data-close-modal>Đóng</button>';
    document.getElementById('modal').hidden = false;
    var first = document.querySelector('#modal-body input, #modal-body select, #modal-body textarea');
    if (first) first.focus();
  }

  function closeModal() {
    document.getElementById('modal').hidden = true;
    document.getElementById('modal-body').innerHTML = '';
    document.getElementById('modal-foot').innerHTML = '';
  }

  function empty(message) {
    return '<div class="admin-empty">' + esc(message) + '</div>';
  }

  function navigate(view) {
    state.view = view;
    document.querySelectorAll('.admin-nav button').forEach(function (button) {
      button.classList.toggle('active', button.getAttribute('data-view') === view);
    });
    document.querySelectorAll('.admin-view').forEach(function (section) {
      section.classList.toggle('active', section.id === 'view-' + view);
    });
    document.getElementById('view-title').textContent = VIEW_TITLES[view] || view;
    if (view === 'overview') loadOverview();
    if (view === 'content' && window.AdminContent) window.AdminContent.load('articles');
    if (view === 'sources') loadSources();
    if (view === 'users') loadUsers();
    if (view === 'audit') loadAudit();
    if (view === 'security') loadSecurity();
    if (view === 'settings') loadSettings();
  }

  function kpi(label, value, note) {
    return '<div class="admin-kpi"><div class="admin-kpi__label">' + esc(label) + '</div>' +
      '<div class="admin-kpi__value">' + esc(value) + '</div><div class="admin-kpi__note">' + esc(note || '') + '</div></div>';
  }

  function loadOverview() {
    api('/api/admin/overview').then(function (payload) {
      var data = payload.overview;
      document.getElementById('overview-kpis').innerHTML = [
        kpi('Bài viết', BK.number(data.articles), data.drafts + ' bản nháp'),
        kpi('Thuật ngữ', BK.number(data.glossary), 'Bốn chuyên ngành'),
        kpi('Hóa chất', BK.number(data.chemicals), 'Hồ sơ có nguồn'),
        kpi('Lỗ hổng', BK.number(data.vulnerabilities), data.knownExploited + ' CVE trong KEV'),
        kpi('Nguồn dữ liệu', BK.number(data.sources.total), data.sources.integrated + ' có connector'),
        kpi('Đã đồng bộ', BK.number(data.sources.synced), data.sources.failing + ' nguồn lỗi'),
        kpi('Người dùng', BK.number(data.users), data.sessions + ' phiên hoạt động'),
        kpi('Audit log', BK.number(data.audit), 'Sự kiện đã ghi')
      ].join('');

      var failing = document.getElementById('overview-failing');
      failing.innerHTML = data.failingSources.length
        ? '<ul class="v2-list">' + data.failingSources.map(function (source) {
            return '<li><div class="v2-list__title">' + esc(source.name) + ' ' + BK.statusBadge('error') + '</div>' +
              '<div class="v2-list__meta">' + esc(source.last_error || 'Không có chi tiết') + '</div></li>';
          }).join('') + '</ul>'
        : empty('Không có nguồn nào đang lỗi.');

      var audit = document.getElementById('overview-audit');
      audit.innerHTML = data.recentAudit.length
        ? '<ul class="v2-list">' + data.recentAudit.map(function (log) {
            return '<li><div class="v2-list__title">' + esc(log.action) + '</div>' +
              '<div class="v2-list__meta">' + esc(log.actor || 'system') + ' · ' + esc(BK.relative(log.created_at)) + '</div></li>';
          }).join('') + '</ul>'
        : empty('Chưa có hoạt động quản trị.');

      var sync = document.getElementById('overview-sync');
      sync.innerHTML = data.recentSyncs.length
        ? '<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Nguồn</th><th>Trạng thái</th><th>Thời điểm</th><th>Kết quả</th></tr></thead><tbody>' +
          data.recentSyncs.slice(0, 6).map(function (log) {
            return '<tr><td>' + esc(log.name || log.source_key) + '</td><td>' + BK.statusBadge(log.status) + '</td>' +
              '<td class="v2-small">' + esc(BK.formatDateTime(log.finished_at || log.started_at)) + '</td>' +
              '<td class="v2-small">' + esc([log.fetched ? 'tải ' + log.fetched : '', log.inserted ? 'thêm ' + log.inserted : '', log.updated ? 'cập nhật ' + log.updated : ''].filter(Boolean).join(' · ') || log.message || '—') + '</td></tr>';
          }).join('') + '</tbody></table></div>'
        : empty('Chưa có lần đồng bộ nào.');
    }).catch(function (error) {
      document.getElementById('overview-kpis').innerHTML = '<div class="v2-alert v2-alert--error">' + esc(error.message) + '</div>';
    });
  }

  function loadSources() {
    api('/api/admin/sources').then(function (payload) {
      var host = document.getElementById('sources-table');
      host.innerHTML = '<table class="admin-table"><thead><tr><th>#</th><th>Nguồn</th><th>Loại</th><th>Trạng thái</th><th>Đồng bộ gần nhất</th><th>Bản ghi</th><th></th></tr></thead><tbody>' +
        payload.sources.map(function (source) {
          var isRef = !source.connector;
          return '<tr><td class="v2-mono">' + source.number + '</td>' +
            '<td><strong>' + esc(source.name) + '</strong><div class="v2-small v2-faint">' + esc(source.source_key) +
              (source.env_var ? ' · ' + esc(source.env_var) : '') + '</div></td>' +
            '<td>' + (isRef ? '<span class="v2-badge v2-badge--neutral">Tham chiếu</span>' :
              source.access_type === 'key' ? '<span class="v2-badge v2-badge--warning">Cần key</span>' :
              '<span class="v2-badge v2-badge--emerald">API</span>') + '</td>' +
            '<td>' + BK.statusBadge(source.status) + (source.last_error ? '<div class="v2-small" style="color:var(--v2-danger)">' + esc(String(source.last_error).slice(0, 70)) + '</div>' : '') + '</td>' +
            '<td class="v2-small">' + esc(source.last_sync_at ? BK.relative(source.last_sync_at) : 'Chưa có') + '</td>' +
            '<td class="v2-mono">' + BK.number(source.record_count) + '</td>' +
            '<td class="actions">' +
              (isRef ? '<span class="v2-small v2-faint">—</span>' :
                '<button class="v2-btn v2-btn--sm" type="button" data-toggle-source="' + esc(source.source_key) + '" data-enabled="' + (source.enabled ? '1' : '0') + '">' + (source.enabled ? 'Tắt' : 'Bật') + '</button>' +
                '<button class="v2-btn v2-btn--sm v2-btn--primary" type="button" data-sync-source="' + esc(source.source_key) + '">Đồng bộ</button>') +
            '</td></tr>';
        }).join('') + '</tbody></table>';

      document.getElementById('sync-logs').innerHTML = payload.logs.length
        ? '<table class="admin-table"><thead><tr><th>Nguồn</th><th>Trạng thái</th><th>Bắt đầu</th><th>Tải</th><th>Thêm</th><th>Cập nhật</th><th>Ghi chú</th></tr></thead><tbody>' +
          payload.logs.map(function (log) {
            return '<tr><td>' + esc(log.source_key) + '</td><td>' + BK.statusBadge(log.status) + '</td>' +
              '<td class="v2-small">' + esc(BK.formatDateTime(log.started_at)) + '</td>' +
              '<td>' + BK.number(log.fetched) + '</td><td>' + BK.number(log.inserted) + '</td><td>' + BK.number(log.updated) + '</td>' +
              '<td class="v2-small">' + esc(String(log.message || '—').slice(0, 110)) + '</td></tr>';
          }).join('') + '</tbody></table>'
        : empty('Chưa có nhật ký.');
    }).catch(function (error) {
      document.getElementById('sources-table').innerHTML = '<div class="v2-alert v2-alert--error">' + esc(error.message) + '</div>';
    });
  }

  function pollSync(jobId) {
    clearInterval(state.syncTimer);
    var host = document.getElementById('sync-job');
    host.innerHTML = '<span class="v2-badge v2-badge--cyan">Đang chạy</span> Tiến trình <span class="admin-key">' + esc(jobId.slice(0, 8)) + '</span>…';
    state.syncTimer = setInterval(function () {
      api('/api/admin/sync/' + encodeURIComponent(jobId)).then(function (payload) {
        var job = payload.job;
        if (job.status === 'running') return;
        clearInterval(state.syncTimer);
        host.innerHTML = BK.statusBadge(job.status) + ' <span class="v2-small">Hoàn tất ' + esc(BK.relative(job.finishedAt)) + '</span>' +
          '<ul>' + (job.results || []).map(function (result) {
            return '<li>' + esc(result.sourceKey) + ': ' + esc(result.status) +
              (result.message ? ' — ' + esc(result.message) : '') + '</li>';
          }).join('') + '</ul>';
        loadSources();
        loadOverview();
      }).catch(function (error) {
        clearInterval(state.syncTimer);
        host.innerHTML = '<div class="v2-alert v2-alert--error">' + esc(error.message) + '</div>';
      });
    }, 1500);
  }

  function startSync(keys) {
    api('/api/admin/sync', { method: 'POST', body: { sources: keys || [] } }).then(function (payload) {
      BK.toast('Đã bắt đầu đồng bộ.');
      navigate('sources');
      pollSync(payload.job.id);
    }).catch(function (error) {
      BK.toast(error.message, 'error');
    });
  }

  function loadUsers() {
    api('/api/admin/users').then(function (payload) {
      document.getElementById('users-table').innerHTML =
        '<table class="admin-table"><thead><tr><th>ID</th><th>Tên đăng nhập</th><th>Vai trò</th><th>Trạng thái</th><th>Đăng nhập cuối</th><th>2FA</th><th></th></tr></thead><tbody>' +
        payload.users.map(function (user) {
          var self = user.id === state.me.id;
          return '<tr><td class="v2-mono">' + user.id + '</td>' +
            '<td><strong>' + esc(user.username) + '</strong>' + (self ? ' <span class="v2-badge v2-badge--neutral">bạn</span>' : '') +
              (user.must_change_password ? '<div class="v2-small v2-faint">Buộc đổi mật khẩu</div>' : '') + '</td>' +
            '<td><select data-user-role="' + user.id + '"' + (self ? ' disabled' : '') + '>' +
              ['admin', 'editor', 'viewer'].map(function (role) {
                return '<option value="' + role + '"' + (user.role === role ? ' selected' : '') + '>' + role + '</option>';
              }).join('') + '</select></td>' +
            '<td>' + (user.is_active ? '<span class="v2-badge v2-badge--emerald">Hoạt động</span>' : '<span class="v2-badge v2-badge--danger">Đã khóa</span>') + '</td>' +
            '<td class="v2-small">' + esc(user.last_login_at ? BK.relative(user.last_login_at) : 'Chưa có') + '</td>' +
            '<td>' + (user.totp_enabled ? '<span class="v2-badge v2-badge--emerald">Bật</span>' : '<span class="v2-badge v2-badge--neutral">Tắt</span>') + '</td>' +
            '<td class="actions">' +
              '<button class="v2-btn v2-btn--sm" type="button" data-reset-user="' + user.id + '">Đặt lại mật khẩu</button>' +
              (!self ? '<button class="v2-btn v2-btn--sm" type="button" data-toggle-user="' + user.id + '" data-active="' + (user.is_active ? '1' : '0') + '">' + (user.is_active ? 'Khóa' : 'Mở') + '</button>' : '') +
            '</td></tr>';
        }).join('') + '</tbody></table>';
    }).catch(function (error) {
      document.getElementById('users-table').innerHTML = '<div class="v2-alert v2-alert--error">' + esc(error.message) + '</div>';
    });
  }

  function loadAudit() {
    api('/api/admin/audit?limit=100').then(function (payload) {
      document.getElementById('audit-table').innerHTML =
        '<table class="admin-table"><thead><tr><th>Thời điểm</th><th>Người thực hiện</th><th>Hành động</th><th>Đối tượng</th><th>IP</th><th>Chi tiết</th></tr></thead><tbody>' +
        payload.logs.map(function (log) {
          return '<tr><td class="v2-small">' + esc(BK.formatDateTime(log.created_at)) + '</td>' +
            '<td>' + esc(log.actor_name || 'system') + '</td><td><code class="admin-key">' + esc(log.action) + '</code></td>' +
            '<td class="v2-small">' + esc(log.entity_type || '—') + ' ' + esc(log.entity_id || '') + '</td>' +
            '<td class="v2-small">' + esc(log.ip || '—') + '</td>' +
            '<td class="v2-small">' + esc(String(log.details || '—').slice(0, 90)) + '</td></tr>';
        }).join('') + '</tbody></table>';
    }).catch(function (error) {
      document.getElementById('audit-table').innerHTML = '<div class="v2-alert v2-alert--error">' + esc(error.message) + '</div>';
    });
  }

  function loadSecurity() {
    api('/api/auth/me').then(function (payload) {
      state.me = payload.user;
      var totp = document.getElementById('totp-panel');
      document.getElementById('totp-state').textContent = payload.user.totpEnabled ? 'Đang bật' : 'Đang tắt';
      if (payload.user.totpEnabled) {
        totp.innerHTML = '<p class="v2-small v2-muted">TOTP đang bảo vệ tài khoản. Để tắt, nhập mật khẩu hiện tại.</p>' +
          '<form id="totp-disable"><div class="v2-field"><label for="totp-password">Mật khẩu</label>' +
          '<input id="totp-password" type="password" autocomplete="current-password" required></div>' +
          '<button class="v2-btn" type="submit">Tắt TOTP</button></form>';
        document.getElementById('totp-disable').addEventListener('submit', function (event) {
          event.preventDefault();
          api('/api/auth/totp/disable', { method: 'POST', body: { password: document.getElementById('totp-password').value } })
            .then(function () { BK.toast('Đã tắt TOTP.'); loadSecurity(); })
            .catch(function (error) { BK.toast(error.message, 'error'); });
        });
      } else {
        totp.innerHTML = '<p class="v2-small v2-muted">Bật TOTP bằng ứng dụng xác thực (Google Authenticator, Aegis, 1Password…).</p>' +
          '<button class="v2-btn v2-btn--primary" type="button" id="totp-setup">Thiết lập TOTP</button><div id="totp-setup-area"></div>';
        document.getElementById('totp-setup').addEventListener('click', function () {
          api('/api/auth/totp/setup', { method: 'POST' }).then(function (payload) {
            document.getElementById('totp-setup-area').innerHTML =
              '<div class="v2-alert v2-alert--warn"><div class="v2-small">Khóa bí mật (nhập thủ công):</div>' +
              '<div class="admin-key" style="margin:6px 0">' + esc(payload.secret) + '</div>' +
              '<div class="v2-small">URI otpauth:</div><div class="admin-key" style="margin:6px 0;word-break:break-all">' + esc(payload.uri) + '</div></div>' +
              '<form id="totp-enable"><div class="v2-field"><label for="totp-code">Mã 6 chữ số từ ứng dụng</label>' +
              '<input id="totp-code" inputmode="numeric" maxlength="6" required></div>' +
              '<button class="v2-btn v2-btn--primary" type="submit">Xác nhận bật</button></form>';
            document.getElementById('totp-enable').addEventListener('submit', function (event) {
              event.preventDefault();
              api('/api/auth/totp/enable', { method: 'POST', body: { code: document.getElementById('totp-code').value } })
                .then(function () { BK.toast('Đã bật TOTP.'); loadSecurity(); })
                .catch(function (error) { BK.toast(error.message, 'error'); });
            });
          }).catch(function (error) { BK.toast(error.message, 'error'); });
        });
      }
      if (payload.user.mustChangePassword) {
        document.getElementById('backup-list').innerHTML = '<div class="admin-hint">Đổi mật khẩu tạm trước khi xem hoặc tạo bản sao lưu.</div>';
        return;
      }
      loadBackups();
    }).catch(function (error) {
      BK.toast(error.message, 'error');
    });
  }

  function loadBackups() {
    api('/api/admin/backups').then(function (payload) {
      var host = document.getElementById('backup-list');
      host.innerHTML = (payload.backups.length ? '<ul class="v2-list">' + payload.backups.map(function (backup) {
        return '<li><div class="v2-list__title">' + esc(backup.filename) + '</div>' +
          '<div class="v2-list__meta">' + (backup.size / 1024).toFixed(1) + ' KB · ' + esc(BK.formatDateTime(backup.createdAt)) + '</div></li>';
      }).join('') + '</ul>' : empty('Chưa có bản sao lưu.')) +
        '<p class="admin-hint">Khôi phục: dừng server, chạy <code class="admin-key">npm run restore -- backups/&lt;file&gt; --yes</code>.</p>';
    }).catch(function () {});
  }

  function loadSettings() {
    api('/api/admin/settings').then(function (payload) {
      document.getElementById('site-title').value = payload.settings.site_title || '';
      document.getElementById('site-description').value = payload.settings.site_description || '';
    }).catch(function (error) { BK.toast(error.message, 'error'); });
  }

  document.getElementById('admin-nav').addEventListener('click', function (event) {
    var button = event.target.closest('button[data-view]');
    if (button) navigate(button.getAttribute('data-view'));
  });

  document.getElementById('modal').addEventListener('click', function (event) {
    if (event.target.id === 'modal' || event.target.closest('[data-close-modal]')) closeModal();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !document.getElementById('modal').hidden) closeModal();
  });

  document.addEventListener('click', function (event) {
    var syncAll = event.target.closest('[data-sync-all]');
    if (syncAll) { startSync([]); return; }
    var single = event.target.closest('[data-sync-source]');
    if (single) { startSync([single.getAttribute('data-sync-source')]); return; }
    var toggle = event.target.closest('[data-toggle-source]');
    if (toggle) {
      var enabled = toggle.getAttribute('data-enabled') !== '1';
      api('/api/admin/sources/' + encodeURIComponent(toggle.getAttribute('data-toggle-source')), {
        method: 'PATCH', body: { enabled: enabled }
      }).then(function () { BK.toast(enabled ? 'Đã bật nguồn.' : 'Đã tắt nguồn.'); loadSources(); })
        .catch(function (error) { BK.toast(error.message, 'error'); });
      return;
    }
    var reset = event.target.closest('[data-reset-user]');
    if (reset) {
      var id = reset.getAttribute('data-reset-user');
      openModal('Đặt lại mật khẩu', '<div class="v2-field"><label for="reset-pass">Mật khẩu mới</label><input id="reset-pass" type="password" autocomplete="new-password"><div class="admin-hint">Người dùng sẽ buộc đổi mật khẩu ở lần đăng nhập kế tiếp.</div></div>',
        '<button class="v2-btn" type="button" data-close-modal>Hủy</button><button class="v2-btn v2-btn--primary" type="button" id="reset-submit">Đặt lại</button>');
      document.getElementById('reset-submit').addEventListener('click', function () {
        api('/api/admin/users/' + id + '/reset-password', { method: 'POST', body: { password: document.getElementById('reset-pass').value } })
          .then(function () { closeModal(); BK.toast('Đã đặt lại mật khẩu.'); })
          .catch(function (error) { BK.toast(error.message, 'error'); });
      });
      return;
    }
    var activeToggle = event.target.closest('[data-toggle-user]');
    if (activeToggle) {
      var active = activeToggle.getAttribute('data-active') === '1';
      if (!window.confirm(active ? 'Khóa tài khoản này?' : 'Mở khóa tài khoản này?')) return;
      api('/api/admin/users/' + activeToggle.getAttribute('data-toggle-user'), { method: 'PATCH', body: { isActive: !active } })
        .then(function () { BK.toast('Đã cập nhật trạng thái.'); loadUsers(); })
        .catch(function (error) { BK.toast(error.message, 'error'); });
      return;
    }
    var addUser = event.target.closest('#add-user');
    if (addUser) {
      openModal('Thêm người dùng',
        '<div class="v2-field"><label for="new-username">Tên đăng nhập</label><input id="new-username" autocomplete="off"></div>' +
        '<div class="v2-field"><label for="new-email">Email (tuỳ chọn)</label><input id="new-email" type="email"></div>' +
        '<div class="v2-field"><label for="new-role">Vai trò</label><select id="new-role"><option value="editor">editor</option><option value="viewer">viewer</option><option value="admin">admin</option></select></div>' +
        '<div class="v2-field"><label for="new-pass">Mật khẩu tạm</label><input id="new-pass" type="password" autocomplete="new-password"><div class="admin-hint">Tối thiểu 12 ký tự, có chữ hoa, chữ thường, số.</div></div>',
        '<button class="v2-btn" type="button" data-close-modal>Hủy</button><button class="v2-btn v2-btn--primary" type="button" id="create-user-submit">Tạo</button>');
      document.getElementById('create-user-submit').addEventListener('click', function () {
        api('/api/admin/users', {
          method: 'POST',
          body: {
            username: document.getElementById('new-username').value.trim(),
            email: document.getElementById('new-email').value.trim(),
            role: document.getElementById('new-role').value,
            password: document.getElementById('new-pass').value
          }
        }).then(function () { closeModal(); BK.toast('Đã tạo người dùng.'); loadUsers(); })
          .catch(function (error) { BK.toast(error.message, 'error'); });
      });
    }
  });

  document.getElementById('users-table').addEventListener('change', function (event) {
    var select = event.target.closest('select[data-user-role]');
    if (!select) return;
    api('/api/admin/users/' + select.getAttribute('data-user-role'), { method: 'PATCH', body: { role: select.value } })
      .then(function () { BK.toast('Đã đổi vai trò.'); })
      .catch(function (error) { BK.toast(error.message, 'error'); loadUsers(); });
  });

  document.getElementById('refresh-audit').addEventListener('click', loadAudit);

  document.getElementById('password-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var current = document.getElementById('current-password').value;
    var next = document.getElementById('new-password').value;
    var confirm = document.getElementById('confirm-password').value;
    if (next !== confirm) { BK.toast('Mật khẩu nhập lại không khớp.', 'error'); return; }
    api('/api/auth/change-password', { method: 'POST', body: { currentPassword: current, newPassword: next } })
      .then(function () {
        BK.toast('Đã đổi mật khẩu. Các phiên khác đã bị hủy.');
        document.getElementById('password-form').reset();
        document.getElementById('password-banner').hidden = true;
        state.me.mustChangePassword = false;
        loadBackups();
      }).catch(function (error) { BK.toast(error.message, 'error'); });
  });

  document.getElementById('create-backup').addEventListener('click', function () {
    api('/api/admin/backup', { method: 'POST' })
      .then(function (payload) { BK.toast('Đã tạo bản sao lưu.'); loadBackups(); })
      .catch(function (error) { BK.toast(error.message, 'error'); });
  });

  document.getElementById('settings-form').addEventListener('submit', function (event) {
    event.preventDefault();
    api('/api/admin/settings', {
      method: 'PATCH',
      body: {
        site_title: document.getElementById('site-title').value.trim(),
        site_description: document.getElementById('site-description').value.trim()
      }
    }).then(function () { BK.toast('Đã lưu cấu hình.'); })
      .catch(function (error) { BK.toast(error.message, 'error'); });
  });

  document.getElementById('logout-btn').addEventListener('click', function () {
    api('/api/auth/logout', { method: 'POST' })
      .then(function () { window.location.replace('/login.html'); })
      .catch(function () { window.location.replace('/login.html'); });
  });

  window.AdminUI = {
    api: api,
    openModal: openModal,
    closeModal: closeModal,
    empty: empty,
    esc: esc,
    state: state,
    loadAudit: loadAudit,
    refreshOverview: loadOverview,
    refreshSources: loadSources
  };

  // Bootstrap phiên: server đã chặn trang nếu chưa đăng nhập admin, nhưng vẫn xác thực lại.
  BK.api('/api/auth/me').then(function (payload) {
    state.me = payload.user;
    state.csrf = payload.csrfToken;
    document.getElementById('user-name').textContent = payload.user.username;
    document.getElementById('user-role').textContent = payload.user.role;
    document.getElementById('user-avatar').textContent = payload.user.username.slice(0, 1).toUpperCase();
    if (payload.user.mustChangePassword) {
      showPasswordBanner();
      navigate('security');
    } else {
      navigate('overview');
    }
  }).catch(function (error) {
    if (error.status === 401) window.location.replace('/login.html?next=/admin/');
    else BK.toast(error.message, 'error');
  });
})();
