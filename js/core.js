(function () {
  'use strict';

  var THEME_KEY = 'bk-theme';

  function currentTheme() {
    try {
      return localStorage.getItem(THEME_KEY) || 'light';
    } catch (e) {
      return 'light';
    }
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    document.querySelectorAll('[data-theme-toggle]').forEach(function (button) {
      button.textContent = theme === 'dark' ? '☀️' : '🌙';
      button.setAttribute('aria-label', theme === 'dark' ? 'Bật chế độ sáng' : 'Bật chế độ tối');
      button.title = theme === 'dark' ? 'Bật chế độ sáng' : 'Bật chế độ tối';
    });
  }

  applyTheme(currentTheme());

  document.addEventListener('click', function (event) {
    var toggle = event.target.closest('[data-theme-toggle]');
    if (toggle) {
      var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch (e) {
        /* localStorage bị chặn */
      }
      applyTheme(next);
    }
  });

  var page = document.body.getAttribute('data-page') || '';

  var NAV = [
    { key: 'dashboard', href: '/dashboard.html', label: 'Tổng quan' },
    { key: 'search', href: '/search.html', label: 'Tra cứu hợp nhất' },
    { key: 'sources', href: '/sources.html', label: 'Nguồn dữ liệu' },
    { key: 'library', href: '/index.html', label: 'Thư viện' },
    { key: 'admin', href: '/admin/', label: 'Quản trị' }
  ];

  var topbarHost = document.querySelector('[data-topbar]');
  if (topbarHost) {
    topbarHost.innerHTML =
      '<div class="v2-container v2-topbar__inner">' +
        '<a class="v2-brand" href="/dashboard.html">' +
          '<span class="v2-brand__mark">🛡</span>' +
          '<span>Bách Khoa Bảo Mật<small>Security &amp; Toxicology</small></span>' +
        '</a>' +
        '<nav class="v2-nav" id="v2-nav" aria-label="Điều hướng chính">' +
          NAV.map(function (item) {
            return '<a href="' + item.href + '"' + (item.key === page ? ' aria-current="page"' : '') + '>' + item.label + '</a>';
          }).join('') +
        '</nav>' +
        '<div class="v2-actions">' +
          '<div class="version-switch" role="group" aria-label="Chọn phiên bản giao diện">' +
            '<a class="version-switch__item" href="/index.html" title="Chuyển sang giao diện 1.0">1.0</a>' +
            '<span class="version-switch__item is-active" aria-current="page">2.0</span>' +
          '</div>' +
          '<button class="v2-icon-btn" type="button" data-theme-toggle aria-label="Bật chế độ tối">🌙</button>' +
          '<button class="v2-icon-btn v2-menu-btn" type="button" id="v2-menu" aria-label="Mở menu" aria-expanded="false">☰</button>' +
        '</div>' +
      '</div>';
  }

  var menuButton = document.getElementById('v2-menu');
  if (menuButton) {
    menuButton.addEventListener('click', function () {
      var nav = document.getElementById('v2-nav');
      if (!nav) return;
      var open = nav.classList.toggle('open');
      menuButton.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  var footerHost = document.querySelector('[data-footer]');
  if (footerHost) {
    footerHost.innerHTML =
      '<div class="v2-container v2-footer__inner">' +
        '<div><strong>Bách Khoa Toàn Thư về Bảo Mật và Khoa Học Độc Học</strong> · Phiên bản 2.0' +
          '<div class="v2-disclaimer">Học liệu giáo dục và phòng ngừa. Không hướng dẫn chế tạo, không thay thế tư vấn y tế hoặc pháp lý. ' +
          'Dữ liệu bên thứ ba thuộc bản quyền/điều khoản của nguồn tương ứng.</div>' +
        '</div>' +
        '<div><a href="/sources.html">Nguồn dữ liệu</a> · <a href="/glossary.html">Thuật ngữ</a> · <a href="/login.html">Đăng nhập quản trị</a></div>' +
      '</div>';
  }

  function api(url, options) {
    var config = options || {};
    var headers = Object.assign({ Accept: 'application/json' }, config.headers || {});
    if (config.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    return fetch(url, {
      method: config.method || 'GET',
      headers: headers,
      body: config.body ? JSON.stringify(config.body) : undefined,
      credentials: 'same-origin',
      signal: config.signal || (window.AbortSignal && AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined)
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (payload) {
        if (!response.ok) {
          var error = new Error((payload.error && payload.error.message) || ('Lỗi HTTP ' + response.status));
          error.code = payload.error && payload.error.code;
          error.status = response.status;
          throw error;
        }
        return payload;
      });
    });
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatDate(value) {
    if (!value) return '—';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('vi-VN', { year: 'numeric', month: '2-digit', day: '2-digit' });
  }

  function formatDateTime(value) {
    if (!value) return '—';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('vi-VN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function relative(value) {
    if (!value) return '—';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    var seconds = Math.round((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return 'vừa xong';
    if (seconds < 3600) return Math.floor(seconds / 60) + ' phút trước';
    if (seconds < 86400) return Math.floor(seconds / 3600) + ' giờ trước';
    if (seconds < 86400 * 30) return Math.floor(seconds / 86400) + ' ngày trước';
    return formatDate(value);
  }

  function number(value) {
    return new Intl.NumberFormat('vi-VN').format(Number(value) || 0);
  }

  var toastTimer = null;
  function toast(message, type) {
    var element = document.querySelector('.v2-toast');
    if (!element) {
      element = document.createElement('div');
      element.className = 'v2-toast';
      element.setAttribute('role', 'status');
      document.body.appendChild(element);
    }
    element.textContent = message;
    element.className = 'v2-toast' + (type === 'error' ? ' v2-toast--error' : '');
    requestAnimationFrame(function () { element.classList.add('show'); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { element.classList.remove('show'); }, 3200);
  }

  function statusBadge(status) {
    var map = {
      ok: ['v2-badge--emerald', 'Đã đồng bộ'],
      success: ['v2-badge--emerald', 'Thành công'],
      running: ['v2-badge--cyan', 'Đang chạy'],
      never: ['v2-badge--neutral', 'Chưa đồng bộ'],
      error: ['v2-badge--danger', 'Lỗi'],
      skipped: ['v2-badge--warning', 'Bỏ qua'],
      key_required: ['v2-badge--warning', 'Cần API key'],
      disabled: ['v2-badge--neutral', 'Đang tắt'],
      partial: ['v2-badge--warning', 'Một phần']
    };
    var entry = map[status] || ['v2-badge--neutral', status || '—'];
    return '<span class="v2-badge ' + entry[0] + '">' + escapeHtml(entry[1]) + '</span>';
  }

  window.BK = {
    api: api,
    escapeHtml: escapeHtml,
    formatDate: formatDate,
    formatDateTime: formatDateTime,
    relative: relative,
    number: number,
    toast: toast,
    statusBadge: statusBadge
  };
})();
