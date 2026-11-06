(function () {
  'use strict';
  var BK = window.BK;
  var form = document.getElementById('login-form');
  var submit = document.getElementById('login-submit');
  var errorBox = document.getElementById('login-error');
  var otpField = document.getElementById('otp-field');
  var otpInput = document.getElementById('otp');
  var params = new URLSearchParams(window.location.search);
  var next = params.get('next') || '/dashboard.html';
  if (!next.startsWith('/') || next.startsWith('//')) next = '/admin/';

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }

  function clearError() {
    errorBox.hidden = true;
    errorBox.textContent = '';
  }

  function showStaticNote() {
    var note = document.querySelector('.v2-password-note');
    if (note) {
      note.textContent = 'Bản tĩnh: mật khẩu được kiểm tra bằng digest ngay trong trình duyệt. Người có quyền truy cập mã nguồn vẫn có thể xem dữ liệu.';
    }
    var security = document.querySelector('.v2-login__security');
    if (security) {
      security.textContent = 'Bản tĩnh chỉ là cổng giao diện; bản chạy server mới bảo vệ nội dung và API.';
    }
  }

  function runtimeMode() {
    var auth = window.BKStaticAuth;
    if (!auth || !auth.ready) return Promise.resolve('server');
    return auth.ready.catch(function () { return 'server'; });
  }

  function staticLogin(auth, username, password) {
    return auth.verify(username, password).then(function (ok) {
      if (!ok) {
        var invalid = new Error('Thông tin đăng nhập không chính xác.');
        invalid.code = 'invalid_credentials';
        throw invalid;
      }
      if (!auth.startSession()) {
        throw new Error('Trình duyệt đang chặn sessionStorage nên không thể lưu phiên đăng nhập.');
      }
      return { redirect: next };
    });
  }

  // Luôn hiển thị form đăng nhập; không tự chuyển hướng khi đã có phiên.
  // Server quyết định việc yêu cầu đăng nhập lại khi truy cập từ ngoài.
  if (window.BKStaticAuth && window.BKStaticAuth.ready) {
    window.BKStaticAuth.ready.then(function (mode) {
      if (mode === 'static') showStaticNote();
    });
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    clearError();
    var username = document.getElementById('username').value.trim();
    var password = document.getElementById('password').value;
    var otp = otpInput.value.trim();
    if (!username || !password) {
      showError('Vui lòng nhập tên đăng nhập và mật khẩu.');
      return;
    }
    submit.disabled = true;
    submit.textContent = 'Đang xác thực…';

    runtimeMode().then(function (mode) {
      if (mode === 'static' && window.BKStaticAuth) {
        showStaticNote();
        return staticLogin(window.BKStaticAuth, username, password);
      }
      return BK.api('/api/auth/login', {
        method: 'POST',
        body: { username: username, password: password, otp: otp, next: next }
      });
    }).then(function (payload) {
      window.location.replace(payload.redirect || next);
    }).catch(function (error) {
      submit.disabled = false;
      submit.textContent = 'Đăng nhập';
      if (error.code === 'totp_required') {
        otpField.hidden = false;
        otpInput.focus();
        showError(error.message);
      } else if (error.code === 'invalid_totp') {
        otpField.hidden = false;
        otpInput.focus();
        otpInput.select();
        showError(error.message);
      } else {
        showError(error.message || 'Đăng nhập thất bại.');
      }
    });
  });
})();
