(function () {
  'use strict';
  var BK = window.BK;
  var type = document.body.getAttribute('data-record');
  var params = new URLSearchParams(window.location.search);

  function esc(value) {
    return BK.escapeHtml(value);
  }

  function paragraph(text) {
    if (!text) return '';
    return esc(text).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>');
  }

  function section(title, text) {
    if (!text) return '';
    return '<h2>' + esc(title) + '</h2><p>' + paragraph(text) + '</p>';
  }

  function facts(rows) {
    return rows.filter(function (row) { return row[1] !== null && row[1] !== undefined && row[1] !== ''; })
      .map(function (row) {
        return '<div class="v2-fact"><dt>' + esc(row[0]) + '</dt><dd>' + row[1] + '</dd></div>';
      }).join('');
  }

  function sources(list, fallback) {
    var host = document.getElementById('record-sources');
    var items = (list || []).filter(function (url) { return /^https?:\/\//i.test(url || ''); });
    if (!items.length && fallback) items = [fallback];
    if (!items.length) {
      host.innerHTML = '<p class="v2-muted v2-small">Chưa có liên kết nguồn cho bản ghi này.</p>';
      return;
    }
    host.innerHTML = '<ul class="v2-list">' + items.map(function (url, index) {
      var label = 'Nguồn tham khảo ' + (index + 1);
      try { label = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { /* giữ nhãn mặc định */ }
      return '<li><a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer" style="color:var(--v2-emerald);font-size:13px">' +
        esc(label) + ' ↗</a></li>';
    }).join('') + '</ul>';
  }

  function showError(message) {
    document.getElementById('record-title').textContent = 'Không tải được hồ sơ';
    document.getElementById('record-content').innerHTML =
      '<div class="v2-alert v2-alert--error">' + esc(message) +
      ' <a href="/search.html">Quay lại tra cứu</a>.</div>';
  }

  function setHero(title, summary, badges) {
    document.getElementById('record-title').textContent = title;
    document.getElementById('record-summary').textContent = summary || '';
    document.getElementById('record-badges').innerHTML = (badges || []).map(function (badge) {
      return '<span class="v2-badge">' + esc(badge) + '</span>';
    }).join('');
    document.title = title + ' — Bách Khoa Bảo mật & Độc học';
  }

  function chemical() {
    var id = params.get('id');
    if (!id) return showError('Thiếu mã hồ sơ hóa chất.');
    BK.api('/api/chemicals/' + encodeURIComponent(id)).then(function (payload) {
      var chem = payload.chemical;
      setHero(chem.name, chem.description, [
        chem.cas_number ? 'CAS ' + chem.cas_number : 'Chưa có CAS',
        chem.molecular_formula || 'Công thức chưa rõ',
        chem.category,
        chem.verification_status === 'curated' ? 'Biên soạn có nguồn' : chem.verification_status
      ]);
      document.getElementById('record-content').innerHTML =
        section('Tên và nhận diện', [chem.common_names, chem.iupac_name].filter(Boolean).join(' · ') || chem.name) +
        section('Đặc tính và công dụng', chem.description) +
        section('Nguy cơ chính', chem.hazards) +
        section('Đường phơi nhiễm', chem.exposure_routes) +
        section('Ảnh hưởng sức khỏe', chem.health_effects) +
        section('Phòng ngừa', chem.prevention) +
        section('Ứng phó an toàn', chem.response) +
        '<blockquote>Không có công thức điều chế, liều gây chết hay hướng dẫn sử dụng gây hại trong hồ sơ này. ' +
        'Trường hợp khẩn cấp gọi 115; mang theo nhãn hoặc bao bì sản phẩm.</blockquote>';
      document.getElementById('record-facts').innerHTML = facts([
        ['Tên', esc(chem.name)],
        ['CAS', esc(chem.cas_number || '—')],
        ['Công thức', esc(chem.molecular_formula || '—')],
        ['Khối lượng phân tử', chem.molecular_weight ? esc(chem.molecular_weight + ' g/mol') : '—'],
        ['PubChem CID', chem.pubchem_cid ? '<a href="https://pubchem.ncbi.nlm.nih.gov/compound/' + esc(chem.pubchem_cid) + '" target="_blank" rel="noopener noreferrer">' + esc(chem.pubchem_cid) + ' ↗</a>' : '—'],
        ['Nhóm', esc(chem.category)],
        ['Cập nhật', esc(BK.formatDate(chem.updated_at))]
      ]);
      sources(chem.sources, chem.source_url);
    }).catch(function (error) {
      showError(error.message);
    });
  }

  function vulnerability() {
    var id = (params.get('cve') || params.get('id') || '').toUpperCase();
    if (!/^CVE-\d{4}-\d{4,7}$/.test(id)) return showError('Mã CVE không hợp lệ. Ví dụ: CVE-2021-44228');
    document.getElementById('record-title').textContent = id;
    BK.api('/api/vulnerabilities/' + encodeURIComponent(id)).then(function (payload) {
      var vuln = payload.vulnerability;
      setHero(id, vuln.title && vuln.title !== id ? vuln.title : 'Hồ sơ lỗ hổng phần mềm', [
        vuln.cvss_severity || 'Chưa có CVSS',
        vuln.known_exploited ? 'CISA KEV — đang bị khai thác' : 'Chưa có bằng chứng KEV',
        vuln.epss_score != null ? 'EPSS ' + Math.round(vuln.epss_score * 10000) / 100 + '%' : 'EPSS chưa có',
        payload.cached ? 'Từ cache' : 'Vừa cập nhật NVD'
      ]);
      var score = vuln.cvss_score != null ? Number(vuln.cvss_score) : null;
      var meterWidth = score == null ? 0 : Math.round((score / 10) * 100);
      var scoreBlock = '<h2>Mức độ nghiêm trọng</h2>' +
        '<div class="v2-score"><span class="v2-score__value">' + (score == null ? '—' : score.toFixed(1)) + '</span>' +
        '<span class="v2-badge ' + (score >= 9 ? 'v2-badge--danger' : 'v2-badge--warning') + '">' + esc(vuln.cvss_severity || 'UNKNOWN') + '</span></div>' +
        '<div class="v2-meter"><span style="width:' + meterWidth + '%"></span></div>';
      document.getElementById('record-content').innerHTML =
        scoreBlock +
        section('Mô tả kỹ thuật', vuln.description) +
        section('Sản phẩm bị ảnh hưởng', vuln.affected_products) +
        section('Hướng khắc phục và giảm thiểu', vuln.remediation) +
        '<blockquote>Trang này chỉ mô tả cơ chế và biện pháp phòng thủ. Không có mã khai thác hoặc hướng dẫn tấn công.</blockquote>';
      document.getElementById('record-facts').innerHTML = facts([
        ['CVE', esc(id)],
        ['CVSS', score == null ? '—' : esc(score.toFixed(1))],
        ['Vector', esc(vuln.cvss_vector || '—')],
        ['EPSS', vuln.epss_score != null ? esc((Number(vuln.epss_score) * 100).toFixed(2) + '%') : '—'],
        ['EPSS percentile', vuln.epss_percentile != null ? esc((Number(vuln.epss_percentile) * 100).toFixed(1) + '%') : '—'],
        ['KEV', vuln.known_exploited ? 'Có' : 'Không'],
        ['Hạn KEV', esc(vuln.kev_due_date || '—')],
        ['Công bố', esc(BK.formatDate(vuln.published_at))],
        ['Cập nhật', esc(BK.formatDate(vuln.modified_at || vuln.updated_at))]
      ]);
      sources([], vuln.source_url || 'https://nvd.nist.gov/vuln/detail/' + id);
    }).catch(function (error) {
      showError(error.message);
    });
  }

  function article() {
    var slug = params.get('slug');
    if (!slug) return showError('Thiếu mã bài viết.');
    BK.api('/api/articles/' + encodeURIComponent(slug)).then(function (payload) {
      if (payload.legacy && payload.url) {
        window.location.replace(payload.url);
        return;
      }
      var item = payload.article;
      setHero(item.title, item.summary, [item.domain, item.verification_status === 'editorial' ? 'Biên soạn nội bộ' : item.verification_status,
        'Cập nhật ' + BK.formatDate(item.updated_at)]);
      document.getElementById('record-content').innerHTML = payload.article.html || '<p>' + esc(item.summary) + '</p>';
      document.getElementById('record-facts').innerHTML = facts([
        ['Lĩnh vực', esc(item.domain)],
        ['Trạng thái', esc(item.status)],
        ['Xác minh', esc(item.verification_status)],
        ['Công bố', esc(BK.formatDate(item.published_at || item.updated_at))],
        ['Cập nhật', esc(BK.formatDate(item.updated_at))]
      ]);
      sources([], item.source_url);
    }).catch(function (error) {
      showError(error.message);
    });
  }

  if (type === 'chemical') chemical();
  else if (type === 'vulnerability') vulnerability();
  else if (type === 'article') article();
  else showError('Loại hồ sơ không được hỗ trợ.');
})();
