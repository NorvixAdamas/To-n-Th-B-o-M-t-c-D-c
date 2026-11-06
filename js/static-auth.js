/*
 * Static-host login fallback.
 *
 * Khi site chạy bằng Express, script này phát hiện /api/auth/me và nhường
 * toàn bộ việc xác thực cho server. Khi site được deploy tĩnh (Netlify),
 * không có API nên dùng kiểm tra digest trong trình duyệt và sessionStorage.
 *
 * Đây chỉ là cổng giao diện, KHÔNG phải ranh giới bảo mật: nội dung tĩnh
 * vẫn nằm trong file nguồn và người có quyền truy cập mã nguồn có thể bỏ qua.
 * Không dùng chế độ này cho dữ liệu thực sự cần bảo mật.
 */
(function () {
  'use strict';

  var LOGIN_PAGE = /\/login(?:\.html)?$/i.test(window.location.pathname);
  var SESSION_KEY = 'bk_static_session_v1';
  var docEl = document.documentElement;

  if (!LOGIN_PAGE) docEl.classList.add('bk-auth-pending');

  // Salt và digest đã được XOR-obfuscate; không có username/password dạng thô.
  var _s1 = [109, 111, 110, 61, 108, 61, 60, 104, 107, 103, 109, 57, 61, 103, 110, 111];
  var _s2 = [158, 197, 145, 196, 193, 149, 144, 158, 147, 193, 158, 194, 193, 159, 146, 147];
  var _h1 = [104, 62, 59, 58, 59, 104, 104, 106, 107, 104, 58, 111, 58, 107, 104, 106, 59, 57, 107, 107, 61, 59, 59, 107, 110, 111, 62, 104, 58, 58, 61, 57];
  var _h2 = [146, 193, 147, 145, 144, 159, 158, 194, 149, 149, 158, 147, 196, 151, 196, 198, 144, 151, 158, 146, 147, 149, 149, 158, 196, 149, 195, 145, 197, 194, 150, 196];

  function decode(part, key) {
    return part.map(function (code) {
      return String.fromCharCode(code ^ key);
    }).join('');
  }

  function getSalt() {
    return decode(_s1, 0x5f) + decode(_s2, 0xa7);
  }

  function getDigest() {
    return decode(_h1, 0x5f) + decode(_h2, 0xa7);
  }

  function sha256(value) {
    if (!window.crypto || !window.crypto.subtle || typeof TextEncoder === 'undefined') {
      return Promise.reject(new Error('Trình duyệt không hỗ trợ kiểm tra mật khẩu tĩnh. Hãy dùng HTTPS hoặc chạy bản server.'));
    }
    return window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)).then(function (buffer) {
      return Array.prototype.map.call(new Uint8Array(buffer), function (byte) {
        return byte.toString(16).padStart(2, '0');
      }).join('');
    });
  }

  function verify(username, password) {
    var expected = getDigest();
    return sha256(getSalt() + '||' + username + '||' + password).then(function (actual) {
      return actual === expected;
    });
  }

  function isAuthenticated() {
    try {
      return window.sessionStorage.getItem(SESSION_KEY) === getDigest();
    } catch (error) {
      return false;
    }
  }

  function startSession() {
    try {
      window.sessionStorage.setItem(SESSION_KEY, getDigest());
      return true;
    } catch (error) {
      return false;
    }
  }

  function clearSession() {
    try {
      window.sessionStorage.removeItem(SESSION_KEY);
    } catch (error) {
      /* storage bị chặn */
    }
  }

  function detectRuntime() {
    if (!window.fetch) return Promise.resolve('static');
    var options = {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    };
    try {
      if (window.AbortSignal && AbortSignal.timeout) options.signal = AbortSignal.timeout(4000);
    } catch (error) {
      /* trình duyệt cũ */
    }
    return window.fetch('/api/auth/me', options).then(function (response) {
      var type = (response.headers.get('content-type') || '').toLowerCase();
      // Server trả JSON (200/401/403/429). Static host trả 404 HTML.
      if (type.indexOf('application/json') !== -1 && response.status !== 404) return 'server';
      return 'static';
    }).catch(function () {
      return 'static';
    });
  }

  function applyMode(mode) {
    if (mode === 'server') {
      docEl.classList.add('bk-server-mode');
      docEl.classList.remove('bk-auth-pending');
      return mode;
    }

    docEl.classList.add('bk-static-mode');

    if (LOGIN_PAGE || isAuthenticated()) {
      docEl.classList.remove('bk-auth-pending');
      return mode;
    }

    var next = window.location.pathname + window.location.search + window.location.hash;
    window.location.replace('/login.html?next=' + encodeURIComponent(next));
    return mode;
  }

  var state = { mode: null };
  var ready = detectRuntime().then(function (mode) {
    state.mode = mode;
    return applyMode(mode);
  });

  window.BKStaticAuth = {
    ready: ready,
    verify: verify,
    isAuthenticated: isAuthenticated,
    startSession: startSession,
    clearSession: clearSession,
    isLoginPage: LOGIN_PAGE,
    get mode() { return state.mode; }
  };
})();
