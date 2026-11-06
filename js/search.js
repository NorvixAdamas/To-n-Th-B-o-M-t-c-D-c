(function () {
  'use strict';
  var BK = window.BK;
  var state = { q: '', type: '', domain: '', sort: 'relevance', page: 1 };
  var meta = { domains: {} };
  var requestId = 0;

  function readUrl() {
    var params = new URLSearchParams(window.location.search);
    state.q = params.get('q') || '';
    state.type = params.get('type') || '';
    state.domain = params.get('domain') || '';
    state.sort = params.get('sort') === 'newest' ? 'newest' : 'relevance';
    state.page = Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1);
    document.getElementById('search-q').value = state.q;
    document.getElementById('sort').value = state.sort;
  }

  function writeUrl() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.type) params.set('type', state.type);
    if (state.domain) params.set('domain', state.domain);
    if (state.sort !== 'relevance') params.set('sort', state.sort);
    if (state.page > 1) params.set('page', String(state.page));
    var url = '/search.html' + (params.toString() ? '?' + params.toString() : '');
    window.history.replaceState(null, '', url);
  }

  function renderFacets(payload) {
    var facets = payload.facets || { types: [], domains: [], sources: [] };
    var html = '<div class="v2-facet"><h3>Loại dữ liệu</h3>';
    html += '<button type="button" data-type="" class="' + (state.type ? '' : 'active') + '"><span>Tất cả</span><span class="count">' + BK.number(payload.total) + '</span></button>';
    facets.types.forEach(function (item) {
      html += '<button type="button" data-type="' + BK.escapeHtml(item.type) + '" class="' + (state.type === item.type ? 'active' : '') + '">' +
        '<span>' + BK.escapeHtml(item.label) + '</span><span class="count">' + BK.number(item.count) + '</span></button>';
    });
    html += '</div><div class="v2-facet"><h3>Lĩnh vực</h3>';
    html += '<button type="button" data-domain="" class="' + (state.domain ? '' : 'active') + '"><span>Tất cả</span></button>';
    facets.domains.forEach(function (item) {
      html += '<button type="button" data-domain="' + BK.escapeHtml(item.key) + '" class="' + (state.domain === item.key ? 'active' : '') + '">' +
        '<span>' + BK.escapeHtml(item.label) + '</span><span class="count">' + BK.number(item.count) + '</span></button>';
    });
    html += '</div>';
    if (facets.sources && facets.sources.length) {
      html += '<div class="v2-facet"><h3>Nguồn (tên miền)</h3>';
      facets.sources.slice(0, 8).forEach(function (item) {
        html += '<button type="button" data-source="' + BK.escapeHtml(item.key) + '"><span>' + BK.escapeHtml(item.key) + '</span><span class="count">' + BK.number(item.count) + '</span></button>';
      });
      html += '</div>';
    }
    document.getElementById('facets').innerHTML = html;
  }

  function renderResults(payload) {
    var host = document.getElementById('results');
    if (!payload.query) {
      host.innerHTML = '<div class="v2-empty"><h3>Bắt đầu tra cứu</h3><p>Nhập tên chất, mã CVE, thuật ngữ hoặc từ khoá. Ví dụ: <em>methanol</em>, <em>ngộ độc</em>, <em>T1190</em>.</p></div>';
      document.getElementById('result-summary').textContent = 'Nhập từ khoá để bắt đầu.';
      document.getElementById('pagination').innerHTML = '';
      return;
    }
    if (!payload.results.length) {
      host.innerHTML = '<div class="v2-empty"><h3>Không có kết quả</h3><p>Thử từ khoá ngắn hơn, bỏ bộ lọc, hoặc kiểm tra chính tả. Tìm kiếm đã bỏ dấu tiếng Việt.</p></div>';
    } else {
      host.innerHTML = payload.results.map(function (item) {
        var external = /^https?:\/\//i.test(item.url || '');
        var domainLabel = meta.domains[item.domain] || item.domain || '';
        return '<a class="v2-result" href="' + BK.escapeHtml(item.url || '#') + '"' +
          (external ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' +
          '<div class="v2-result__top"><span class="v2-result__type">' + BK.escapeHtml(item.icon + ' ' + item.typeLabel) + '</span>' +
            (item.badge ? '<span class="v2-badge v2-badge--danger">' + BK.escapeHtml(item.badge) + '</span>' : '') +
            (external ? '<span class="v2-badge v2-badge--neutral">nguồn ngoài ↗</span>' : '') +
          '</div>' +
          '<h3>' + BK.escapeHtml(item.title) + '</h3>' +
          (item.snippet ? '<p>' + BK.escapeHtml(item.snippet) + '</p>' : '') +
          '<div class="v2-result__meta">' +
            (domainLabel ? '<span>' + BK.escapeHtml(domainLabel) + '</span>' : '') +
            (item.sourceHost ? '<span>' + BK.escapeHtml(item.sourceHost) + '</span>' : '') +
            (item.date ? '<span>Cập nhật ' + BK.escapeHtml(BK.formatDate(item.date)) + '</span>' : '') +
          '</div></a>';
      }).join('');
    }
    document.getElementById('result-summary').innerHTML =
      '<strong>' + BK.number(payload.total) + '</strong> kết quả cho “' + BK.escapeHtml(payload.query) + '” · ' + payload.durationMs + ' ms';
    document.getElementById('pagination').innerHTML = payload.pages > 1
      ? '<button class="v2-btn v2-btn--sm" type="button" data-page="' + (payload.page - 1) + '"' + (payload.page <= 1 ? ' disabled' : '') + '>← Trước</button>' +
        '<span class="v2-small v2-muted">Trang ' + payload.page + ' / ' + payload.pages + '</span>' +
        '<button class="v2-btn v2-btn--sm" type="button" data-page="' + (payload.page + 1) + '"' + (payload.page >= payload.pages ? ' disabled' : '') + '>Sau →</button>'
      : '';
  }

  function runSearch() {
    var id = ++requestId;
    var params = new URLSearchParams({ limit: '12', page: String(state.page), sort: state.sort });
    if (state.q) params.set('q', state.q);
    if (state.type) params.set('type', state.type);
    if (state.domain) params.set('domain', state.domain);
    document.getElementById('results').innerHTML = '<p class="v2-muted v2-small">Đang tìm…</p>';
    BK.api('/api/search?' + params.toString()).then(function (payload) {
      if (id !== requestId) return;
      renderFacets(payload);
      renderResults(payload);
    }).catch(function (error) {
      document.getElementById('results').innerHTML = '<div class="v2-alert v2-alert--error">' + BK.escapeHtml(error.message) + '</div>';
    });
  }

  document.getElementById('search-form').addEventListener('submit', function (event) {
    event.preventDefault();
    state.q = document.getElementById('search-q').value.trim();
    state.page = 1;
    writeUrl();
    runSearch();
  });

  document.getElementById('sort').addEventListener('change', function (event) {
    state.sort = event.target.value;
    state.page = 1;
    writeUrl();
    runSearch();
  });

  document.getElementById('facets').addEventListener('click', function (event) {
    var button = event.target.closest('button[data-type], button[data-domain], button[data-source]');
    if (!button) return;
    if (button.hasAttribute('data-type')) state.type = button.getAttribute('data-type');
    if (button.hasAttribute('data-domain')) state.domain = button.getAttribute('data-domain');
    if (button.hasAttribute('data-source')) {
      document.getElementById('search-q').value = button.getAttribute('data-source');
      state.q = button.getAttribute('data-source');
    }
    state.page = 1;
    writeUrl();
    runSearch();
  });

  document.getElementById('reset-filters').addEventListener('click', function () {
    state.type = '';
    state.domain = '';
    state.page = 1;
    writeUrl();
    runSearch();
  });

  document.getElementById('pagination').addEventListener('click', function (event) {
    var button = event.target.closest('button[data-page]');
    if (!button || button.disabled) return;
    state.page = Math.max(1, Number(button.getAttribute('data-page')));
    writeUrl();
    runSearch();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  BK.api('/api/meta').then(function (payload) {
    payload.domains.forEach(function (domain) { meta.domains[domain.key] = domain.label; });
    readUrl();
    runSearch();
  }).catch(function () {
    readUrl();
    runSearch();
  });
})();
