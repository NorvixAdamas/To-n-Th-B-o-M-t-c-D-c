(function () {
  'use strict';
  var BK = window.BK;
  var GROUPS = [
    { key: 'cyber', label: 'An ninh mạng & Tình báo mối đe dọa', icon: '🛡', note: '12 nguồn' },
    { key: 'chem', label: 'Hóa học & Độc học', icon: '🧪', note: '11 nguồn' },
    { key: 'food', label: 'An toàn thực phẩm & Y tế', icon: '🍽', note: '4 nguồn' },
    { key: 'safety', label: 'Vũ khí, pháp luật & An toàn', icon: '⚖', note: '5 nguồn' }
  ];

  function accessBadge(source) {
    if (source.access_type === 'open') return '<span class="v2-badge v2-badge--emerald">API công khai</span>';
    if (source.access_type === 'key') return '<span class="v2-badge v2-badge--warning">Cần API key</span>';
    if (source.access_type === 'restricted') return '<span class="v2-badge v2-badge--danger">Truy cập giới hạn</span>';
    return '<span class="v2-badge v2-badge--neutral">Chỉ tham chiếu</span>';
  }

  function syncLabel(source) {
    if (!source.connector) return '<span class="v2-badge v2-badge--neutral">Không đồng bộ</span>';
    if (source.status === 'ok') return '<span class="v2-badge v2-badge--emerald"><span class="v2-dot v2-dot--ok"></span> Đã đồng bộ</span>';
    if (source.status === 'key_required') return '<span class="v2-badge v2-badge--warning"><span class="v2-dot v2-dot--key"></span> Thiếu key</span>';
    if (source.status === 'error') return '<span class="v2-badge v2-badge--danger"><span class="v2-dot v2-dot--error"></span> Lỗi đồng bộ</span>';
    if (source.status === 'disabled') return '<span class="v2-badge v2-badge--neutral">Đang tắt</span>';
    return '<span class="v2-badge v2-badge--neutral">Chưa đồng bộ</span>';
  }

  function render(payload) {
    var summary = document.getElementById('source-summary');
    var integrated = payload.sources.filter(function (s) { return Boolean(s.connector); }).length;
    var synced = payload.sources.filter(function (s) { return Boolean(s.last_sync_at); }).length;
    var reference = payload.sources.filter(function (s) { return !s.connector; }).length;
    summary.innerHTML = '<span>' + payload.total + ' nguồn</span><span>' + integrated + ' có connector</span><span>' +
      synced + ' đã đồng bộ</span><span>' + reference + ' chỉ tham chiếu</span>';

    var host = document.getElementById('source-groups');
    host.innerHTML = GROUPS.map(function (group) {
      var items = payload.sources.filter(function (s) { return s.category === group.key; });
      if (!items.length) return '';
      return '<section class="v2-source-group">' +
        '<div class="v2-source-group__head"><h2>' + group.icon + ' ' + group.label + '</h2>' +
          '<span class="v2-badge v2-badge--neutral">' + items.length + ' nguồn</span></div>' +
        '<div class="v2-card">' +
        items.map(function (source) {
          var meta = [
            source.organization ? BK.escapeHtml(source.organization) : '',
            source.license ? 'Giấy phép: ' + BK.escapeHtml(source.license) : ''
          ].filter(Boolean).join(' · ');
          return '<div class="v2-source-card">' +
            '<div class="v2-source-card__num">' + String(source.number).padStart(2, '0') + '</div>' +
            '<div>' +
              '<h3><a href="' + BK.escapeHtml(source.url) + '" target="_blank" rel="noopener noreferrer">' +
                BK.escapeHtml(source.name) + ' ↗</a>' + accessBadge(source) + '</h3>' +
              (meta ? '<p>' + meta + '</p>' : '') +
              (source.notes ? '<p>' + BK.escapeHtml(source.notes) + '</p>' : '') +
              '<p class="v2-faint">' + syncLabel(source) +
                (source.last_sync_at ? ' <span>Cập nhật ' + BK.escapeHtml(BK.relative(source.last_sync_at)) + '</span>' : '') +
                (source.record_count ? ' <span>· ' + BK.number(source.record_count) + ' bản ghi</span>' : '') +
              '</p>' +
              (source.last_error ? '<p class="v2-small" style="color:var(--v2-danger)">' + BK.escapeHtml(source.last_error) + '</p>' : '') +
            '</div>' +
            '<div class="v2-source-card__side">' +
              (source.requires_key && source.env_var ? '<strong>' + BK.escapeHtml(source.env_var) + '</strong>' : '') +
              (source.connector ? '<span>Connector: ' + BK.escapeHtml(source.connector) + '</span>' : '<span>Tham chiếu</span>') +
            '</div>' +
          '</div>';
        }).join('') +
        '</div></section>';
    }).join('');
  }

  BK.api('/api/sources').then(render).catch(function (error) {
    document.getElementById('source-groups').innerHTML =
      '<div class="v2-alert v2-alert--error">' + BK.escapeHtml(error.message) + '</div>';
  });
})();
