(function () {
  'use strict';
  var BK = window.BK;

  function statCard(label, value, note, accent) {
    return '<div class="v2-stat' + (accent ? ' v2-stat--accent' : '') + '">' +
      '<div class="v2-stat__label">' + BK.escapeHtml(label) + '</div>' +
      '<div class="v2-stat__value">' + BK.escapeHtml(value) + '</div>' +
      '<div class="v2-stat__note">' + BK.escapeHtml(note) + '</div></div>';
  }

  function loadStats() {
    return BK.api('/api/stats').then(function (payload) {
      var stats = payload.stats;
      var grid = document.getElementById('stats-grid');
      grid.innerHTML = [
        statCard('Thuật ngữ', BK.number(stats.glossary), 'Bốn chuyên ngành', true),
        statCard('Hồ sơ hóa chất', BK.number(stats.chemicals), 'Có nguồn tham khảo'),
        statCard('Lỗ hổng theo dõi', BK.number(stats.vulnerabilities), BK.number(stats.knownExploited) + ' CVE đang bị khai thác'),
        statCard('Nguồn đã đồng bộ', BK.number(stats.sources.synced) + '/' + BK.number(stats.sources.total), 'Đồng bộ và tham chiếu'),
        statCard('Nghiên cứu & pháp lý', BK.number(stats.research + stats.legal + stats.protocols), 'PubMed · VBPL · quy trình')
      ].join('');

      var severity = document.getElementById('severity-list');
      if (!stats.severity || !stats.severity.length) {
        severity.innerHTML = '<p class="v2-muted v2-small">Chưa có dữ liệu lỗ hổng.</p>';
        return;
      }
      var max = Math.max.apply(null, stats.severity.map(function (s) { return s.count; }));
      severity.innerHTML = stats.severity.map(function (item) {
        var width = Math.round((item.count / max) * 100);
        var color = item.severity === 'CRITICAL' ? '#c0392b' : item.severity === 'HIGH' ? '#c47a1c' : '#1f9fb5';
        return '<div style="margin-bottom:12px">' +
          '<div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:5px">' +
            '<span><strong>' + BK.escapeHtml(item.severity) + '</strong></span><span class="v2-muted">' + BK.number(item.count) + ' CVE</span>' +
          '</div>' +
          '<div class="v2-meter"><span style="width:' + width + '%;background:' + color + '"></span></div>' +
        '</div>';
      }).join('');
    }).catch(function (error) {
      document.getElementById('severity-list').innerHTML =
        '<div class="v2-alert v2-alert--error">' + BK.escapeHtml(error.message) + '</div>';
    });
  }

  function loadSources() {
    return BK.api('/api/sources').then(function (payload) {
      var integrated = payload.integrated;
      var synced = payload.sources.filter(function (s) { return Boolean(s.last_sync_at); }).length;
      var failing = payload.sources.filter(function (s) { return s.status === 'error'; }).length;
      var keyed = payload.sources.filter(function (s) { return s.access_type === 'key'; }).length;
      document.getElementById('source-summary').innerHTML =
        '<div style="display:grid;gap:10px">' +
          '<div style="display:flex;justify-content:space-between"><span class="v2-muted v2-small">Tổng số nguồn</span><strong>' + payload.total + '</strong></div>' +
          '<div style="display:flex;justify-content:space-between"><span class="v2-muted v2-small">Có connector</span><strong>' + integrated + '</strong></div>' +
          '<div style="display:flex;justify-content:space-between"><span class="v2-muted v2-small">Đã đồng bộ ít nhất một lần</span><strong>' + synced + '</strong></div>' +
          '<div style="display:flex;justify-content:space-between"><span class="v2-muted v2-small">Cần API key</span><strong>' + keyed + '</strong></div>' +
          '<div style="display:flex;justify-content:space-between"><span class="v2-muted v2-small">Đang lỗi</span><strong style="color:' + (failing ? '#c0392b' : 'inherit') + '">' + failing + '</strong></div>' +
        '</div>';
      document.getElementById('source-foot').textContent =
        'Các nguồn chỉ tham chiếu (CAPEC, ECHA, IFRT…) không được tính là đã tích hợp.';
    }).catch(function (error) {
      document.getElementById('source-summary').innerHTML =
        '<div class="v2-alert v2-alert--error">' + BK.escapeHtml(error.message) + '</div>';
    });
  }

  function loadLogs() {
    return BK.api('/api/sources/logs').then(function (payload) {
      var host = document.getElementById('recent-sync');
      if (!payload.logs.length) {
        host.innerHTML = '<p class="v2-muted v2-small">Chưa có lần đồng bộ nào. Quản trị viên có thể chạy đồng bộ từ trang quản trị.</p>';
        return;
      }
      host.innerHTML = '<ul class="v2-list">' + payload.logs.slice(0, 5).map(function (log) {
        return '<li><div class="v2-list__title">' + BK.escapeHtml(log.source_name || log.source_key) + '</div>' +
          '<div class="v2-list__meta">' + BK.statusBadge(log.status) + ' · ' + BK.escapeHtml(BK.relative(log.finished_at || log.started_at)) +
          (log.message ? ' · ' + BK.escapeHtml(String(log.message).slice(0, 90)) : '') + '</div></li>';
      }).join('') + '</ul>';
    }).catch(function (error) {
      document.getElementById('recent-sync').innerHTML =
        '<div class="v2-alert v2-alert--error">' + BK.escapeHtml(error.message) + '</div>';
    });
  }

  document.getElementById('global-search').addEventListener('submit', function (event) {
    event.preventDefault();
    var query = document.getElementById('global-q').value.trim();
    window.location.href = '/search.html' + (query ? '?q=' + encodeURIComponent(query) : '');
  });

  document.getElementById('quick-cve').addEventListener('submit', function (event) {
    event.preventDefault();
    var value = document.getElementById('cve-input').value.trim();
    if (!/^CVE-\d{4}-\d{4,7}$/i.test(value)) {
      BK.toast('Mã CVE không hợp lệ. Ví dụ: CVE-2021-44228', 'error');
      return;
    }
    window.location.href = '/vulnerability.html?id=' + encodeURIComponent(value.toUpperCase());
  });

  document.getElementById('quick-cas').addEventListener('submit', function (event) {
    event.preventDefault();
    var value = document.getElementById('cas-input').value.trim();
    if (!value) return;
    window.location.href = '/chemical.html?id=' + encodeURIComponent(value);
  });

  loadStats();
  loadSources();
  loadLogs();
})();
