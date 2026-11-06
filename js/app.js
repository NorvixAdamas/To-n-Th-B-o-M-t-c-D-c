(function () {
  'use strict';

  var THEME_KEY = 'bk-theme';

  // ---------- Liên kết tra cứu số trên các trang thư viện cũ ----------
  var navList = document.querySelector('.nav-links');
  if (navList && !navList.querySelector('[data-v2-link]')) {
    var item = document.createElement('li');
    var link = document.createElement('a');
    link.href = 'dashboard.html';
    link.textContent = 'Tra cứu số';
    link.setAttribute('data-v2-link', '1');
    item.appendChild(link);
    navList.appendChild(item);
  }

  // ---------- Chế độ tối / sáng ----------
  var root = document.documentElement;

  function currentTheme() {
    try {
      return localStorage.getItem(THEME_KEY) || 'light';
    } catch (e) {
      return 'light';
    }
  }

  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
    var buttons = document.querySelectorAll('#theme-toggle, [data-theme-toggle]');
    Array.prototype.forEach.call(buttons, function (toggle) {
      toggle.textContent = theme === 'dark' ? '☀️' : '🌙';
      toggle.setAttribute('aria-label', theme === 'dark' ? 'Bật chế độ sáng' : 'Bật chế độ tối');
      toggle.setAttribute('title', theme === 'dark' ? 'Bật chế độ sáng' : 'Bật chế độ tối');
    });
  }

  applyTheme(currentTheme());

  document.addEventListener('click', function (event) {
    var toggle = event.target.closest('#theme-toggle, [data-theme-toggle]');
    if (!toggle) return;
    var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (e) {
      /* bỏ qua nếu localStorage bị chặn */
    }
    applyTheme(next);
  });

  // ---------- Tìm kiếm bảng thuật ngữ ----------
  var searchInput = document.getElementById('glossary-search');
  if (searchInput) {
    var terms = document.querySelectorAll('.glossary-term');
    var count = document.getElementById('glossary-count');

    function normalize(s) {
      return (s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd');
    }

    function filter() {
      var q = normalize(searchInput.value.trim());
      var visible = 0;
      Array.prototype.forEach.call(terms, function (term) {
        var show = !q || normalize(term.textContent).indexOf(q) !== -1;
        term.style.display = show ? '' : 'none';
        if (show) visible += 1;
      });
      if (count) {
        count.textContent = q
          ? 'Hiển thị ' + visible + ' / ' + terms.length + ' thuật ngữ'
          : terms.length + ' thuật ngữ';
      }
    }

    // Hỗ trợ liên kết /glossary.html?q=... từ tìm kiếm hợp nhất.
    try {
      var initial = new URLSearchParams(window.location.search).get('q');
      if (initial) searchInput.value = initial;
    } catch (e) {
      /* bỏ qua */
    }

    searchInput.addEventListener('input', filter);
    filter();
  }
})();

(function () {
  'use strict';

  var doc = document.documentElement;

  // Thanh tiến độ đọc
  var progressBar = document.createElement('div');
  progressBar.className = 'reading-progress';
  progressBar.setAttribute('aria-hidden', 'true');
  var progressInner = document.createElement('span');
  progressInner.className = 'reading-progress__bar';
  progressBar.appendChild(progressInner);
  document.body.insertBefore(progressBar, document.body.firstChild);

  // Nút quay lại đầu trang
  var backToTop = document.createElement('button');
  backToTop.className = 'back-to-top';
  backToTop.type = 'button';
  backToTop.setAttribute('aria-label', 'Quay lại đầu trang');
  backToTop.title = 'Quay lại đầu trang';
  backToTop.textContent = '↑';
  document.body.appendChild(backToTop);

  // Scrollspy: tô sáng mục lục theo vị trí đọc
  var tocLinks = Array.prototype.slice.call(document.querySelectorAll('.sidebar-toc a'));

  function update() {
    var scrollTop = window.pageYOffset || doc.scrollTop || 0;
    var height = (doc.scrollHeight || document.body.scrollHeight) - (doc.clientHeight || window.innerHeight);
    progressInner.style.width = (height > 0 ? (scrollTop / height) * 100 : 0) + '%';
    backToTop.classList.toggle('visible', scrollTop > 400);

    if (tocLinks.length) {
      var current = null;
      for (var i = 0; i < tocLinks.length; i++) {
        var href = tocLinks[i].getAttribute('href');
        if (!href || href.charAt(0) !== '#') continue;
        var target = document.querySelector(href);
        if (!target) continue;
        if (target.getBoundingClientRect().top <= 140) current = href;
      }
      for (var j = 0; j < tocLinks.length; j++) {
        tocLinks[j].classList.toggle('active', tocLinks[j].getAttribute('href') === current);
      }
    }
  }

  backToTop.addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  var ticking = false;
  window.addEventListener('scroll', function () {
    if (!ticking) {
      window.requestAnimationFrame(function () {
        update();
        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });

  update();
})();
