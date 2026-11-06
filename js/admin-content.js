(function () {
  'use strict';
  if (!window.AdminUI) return;
  var UI = window.AdminUI;
  var api = UI.api;
  var esc = UI.esc;
  var BK = window.BK;
  var currentTab = 'articles';
  var DOMAINS = {
    cybersecurity: 'An ninh mạng',
    toxicology: 'Độc học',
    'food-safety': 'An toàn thực phẩm',
    weapons: 'Vũ khí & đồ cấm',
    safety: 'An toàn đời sống',
    forensic: 'Pháp y',
    environment: 'Môi trường',
    legal: 'Pháp luật',
    medical: 'Y khoa'
  };

  function domainOptions(selected) {
    return Object.keys(DOMAINS).map(function (key) {
      return '<option value="' + key + '"' + (selected === key ? ' selected' : '') + '>' + esc(DOMAINS[key]) + '</option>';
    }).join('');
  }

  function statusBadge(status) {
    if (status === 'published') return '<span class="v2-badge v2-badge--emerald">Đã đăng</span>';
    if (status === 'draft') return '<span class="v2-badge v2-badge--warning">Nháp</span>';
    return '<span class="v2-badge v2-badge--neutral">' + esc(status) + '</span>';
  }

  function toolbar(title, buttonId, label, searchPlaceholder) {
    return '<div class="admin-section-head" style="margin-bottom:10px"><div><h3 style="margin:0">' + title + '</h3></div>' +
      '<button class="v2-btn v2-btn--primary" type="button" id="' + buttonId + '">' + label + '</button></div>' +
      '<div class="admin-search"><input id="content-search" placeholder="' + esc(searchPlaceholder) + '" autocomplete="off"><button class="v2-btn" type="button" id="content-search-btn">Tìm</button></div>';
  }

  function loadArticles() {
    api('/api/admin/articles').then(function (payload) {
      var host = document.getElementById('content-body');
      host.innerHTML = toolbar('Bài viết', 'new-article', '+ Bài mới', 'Tìm theo tiêu đề…') +
        '<div class="v2-card"><div class="v2-card__body admin-table-wrap"><table class="admin-table"><thead><tr>' +
        '<th>Tiêu đề</th><th>Lĩnh vực</th><th>Loại</th><th>Trạng thái</th><th>Cập nhật</th><th></th></tr></thead><tbody>' +
        payload.articles.map(function (article) {
          return '<tr><td><strong>' + esc(article.title) + '</strong><div class="v2-small v2-faint">' + esc(article.slug) + '</div></td>' +
            '<td>' + esc(DOMAINS[article.domain] || article.domain) + '</td>' +
            '<td>' + (article.content_type === 'legacy' ? '<span class="v2-badge v2-badge--neutral">HTML cũ</span>' : '<span class="v2-badge v2-badge--cyan">CSDL</span>') + '</td>' +
            '<td>' + statusBadge(article.status) + '</td>' +
            '<td class="v2-small">' + esc(BK.formatDate(article.updated_at)) + '</td>' +
            '<td class="actions"><button class="v2-btn v2-btn--sm" type="button" data-edit-article="' + article.id + '">Sửa</button>' +
            '<button class="v2-btn v2-btn--sm" type="button" data-delete-article="' + article.id + '">Xóa</button></td></tr>';
        }).join('') + '</tbody></table></div></div>';

      document.getElementById('new-article').addEventListener('click', function () { articleForm(null); });
      document.getElementById('content-search-btn').addEventListener('click', searchArticles);
      document.getElementById('content-search').addEventListener('keydown', function (event) {
        if (event.key === 'Enter') searchArticles();
      });
    }).catch(function (error) {
      document.getElementById('content-body').innerHTML = '<div class="v2-alert v2-alert--error">' + esc(error.message) + '</div>';
    });
  }

  function searchArticles() {
    var q = document.getElementById('content-search').value.trim();
    api('/api/admin/articles' + (q ? '?q=' + encodeURIComponent(q) : '')).then(function (payload) {
      var body = document.querySelector('#content-body table tbody');
      if (!body) return;
      body.innerHTML = payload.articles.map(function (article) {
        return '<tr><td><strong>' + esc(article.title) + '</strong><div class="v2-small v2-faint">' + esc(article.slug) + '</div></td>' +
          '<td>' + esc(DOMAINS[article.domain] || article.domain) + '</td>' +
          '<td>' + (article.content_type === 'legacy' ? 'HTML cũ' : 'CSDL') + '</td>' +
          '<td>' + statusBadge(article.status) + '</td><td class="v2-small">' + esc(BK.formatDate(article.updated_at)) + '</td>' +
          '<td class="actions"><button class="v2-btn v2-btn--sm" type="button" data-edit-article="' + article.id + '">Sửa</button>' +
          '<button class="v2-btn v2-btn--sm" type="button" data-delete-article="' + article.id + '">Xóa</button></td></tr>';
      }).join('') || '<tr><td colspan="6" class="admin-empty">Không có kết quả.</td></tr>';
    }).catch(function (error) { BK.toast(error.message, 'error'); });
  }

  function articleForm(article) {
    var editing = Boolean(article);
    var legacy = editing && article.content_type === 'legacy';
    UI.openModal(editing ? 'Sửa bài viết' : 'Bài viết mới',
      '<div class="v2-field"><label for="a-title">Tiêu đề</label><input id="a-title" maxlength="240" value="' + esc(article ? article.title : '') + '"></div>' +
      '<div class="v2-form-row"><div class="v2-field"><label for="a-domain">Lĩnh vực</label><select id="a-domain">' + domainOptions(article ? article.domain : 'cybersecurity') + '</select></div>' +
      '<div class="v2-field"><label for="a-status">Trạng thái</label><select id="a-status"><option value="draft"' + (article && article.status === 'draft' ? ' selected' : '') + '>Nháp</option><option value="published"' + (!article || article.status === 'published' ? ' selected' : '') + '>Đăng</option><option value="archived"' + (article && article.status === 'archived' ? ' selected' : '') + '>Lưu trữ</option></select></div></div>' +
      '<div class="v2-field"><label for="a-summary">Tóm tắt</label><textarea id="a-summary" maxlength="600" style="min-height:70px">' + esc(article ? article.summary || '' : '') + '</textarea></div>' +
      (legacy ? '<div class="v2-alert v2-alert--warn">Bài viết gốc dạng HTML: chỉ sửa được metadata. Nội dung khoa học trong file HTML được giữ nguyên.</div>' :
        '<div class="v2-field"><label for="a-body">Nội dung (Markdown tối giản)</label><textarea id="a-body" style="min-height:240px">' + esc(article ? article.body || '' : '') + '</textarea><div class="admin-hint">Hỗ trợ ##, danh sách, **đậm**, *nghiêng*, trích dẫn và liên kết http(s). HTML thô bị escape.</div></div>') +
      '<div class="v2-field"><label for="a-source">URL nguồn (tuỳ chọn)</label><input id="a-source" value="' + esc(article ? article.source_url || '' : '') + '"></div>',
      '<button class="v2-btn" type="button" data-close-modal>Hủy</button><button class="v2-btn v2-btn--primary" type="button" id="save-article">Lưu</button>');

    document.getElementById('save-article').addEventListener('click', function () {
      var body = {
        title: document.getElementById('a-title').value.trim(),
        domain: document.getElementById('a-domain').value,
        status: document.getElementById('a-status').value,
        summary: document.getElementById('a-summary').value.trim(),
        sourceUrl: document.getElementById('a-source').value.trim()
      };
      var bodyField = document.getElementById('a-body');
      if (bodyField) body.body = bodyField.value;
      var request = editing
        ? api('/api/admin/articles/' + article.id, { method: 'PATCH', body: body })
        : api('/api/admin/articles', { method: 'POST', body: body });
      request.then(function () {
        UI.closeModal();
        BK.toast(editing ? 'Đã cập nhật bài viết.' : 'Đã tạo bài viết.');
        loadArticles();
        UI.loadAudit();
      }).catch(function (error) { BK.toast(error.message, 'error'); });
    });
  }

  function editArticle(id) {
    api('/api/admin/articles/' + id).then(function (payload) {
      articleForm(payload.article);
    }).catch(function (error) { BK.toast(error.message, 'error'); });
  }

  function deleteArticle(id) {
    if (!window.confirm('Xóa bài viết này? Thao tác không thể hoàn tác nếu không có bản sao lưu.')) return;
    api('/api/admin/articles/' + id, { method: 'DELETE' }).then(function () {
      BK.toast('Đã xóa bài viết.');
      loadArticles();
    }).catch(function (error) { BK.toast(error.message, 'error'); });
  }

  // ----- Thuật ngữ -----
  function loadGlossary() {
    api('/api/admin/glossary').then(function (payload) {
      var host = document.getElementById('content-body');
      host.innerHTML = toolbar('Thuật ngữ', 'new-term', '+ Thuật ngữ', 'Tìm thuật ngữ…') +
        '<div class="v2-card"><div class="v2-card__body admin-table-wrap"><table class="admin-table"><thead><tr>' +
        '<th>Thuật ngữ</th><th>Lĩnh vực</th><th>Định nghĩa</th><th>Cập nhật</th><th></th></tr></thead><tbody>' +
        payload.glossary.map(function (term) {
          return '<tr><td><strong>' + esc(term.term) + '</strong>' + (term.locked ? ' <span class="v2-badge v2-badge--neutral">đã sửa</span>' : '') + '</td>' +
            '<td>' + esc(DOMAINS[term.domain] || term.domain) + '</td>' +
            '<td class="v2-small">' + esc(String(term.definition).slice(0, 120)) + '…</td>' +
            '<td class="v2-small">' + esc(BK.formatDate(term.updated_at)) + '</td>' +
            '<td class="actions"><button class="v2-btn v2-btn--sm" type="button" data-edit-term="' + term.id + '">Sửa</button>' +
            '<button class="v2-btn v2-btn--sm" type="button" data-delete-term="' + term.id + '">Xóa</button></td></tr>';
        }).join('') + '</tbody></table></div></div>';

      document.getElementById('new-term').addEventListener('click', function () { termForm(null); });
      document.getElementById('content-search-btn').addEventListener('click', function () {
        var q = document.getElementById('content-search').value.trim();
        api('/api/admin/glossary' + (q ? '?q=' + encodeURIComponent(q) : '')).then(function (data) {
          var body = document.querySelector('#content-body table tbody');
          if (!body) return;
          body.innerHTML = data.glossary.map(function (term) {
            return '<tr><td><strong>' + esc(term.term) + '</strong></td><td>' + esc(DOMAINS[term.domain] || term.domain) + '</td>' +
              '<td class="v2-small">' + esc(String(term.definition).slice(0, 120)) + '…</td><td class="v2-small">' + esc(BK.formatDate(term.updated_at)) + '</td>' +
              '<td class="actions"><button class="v2-btn v2-btn--sm" type="button" data-edit-term="' + term.id + '">Sửa</button>' +
              '<button class="v2-btn v2-btn--sm" type="button" data-delete-term="' + term.id + '">Xóa</button></td></tr>';
          }).join('') || '<tr><td colspan="5" class="admin-empty">Không có kết quả.</td></tr>';
        });
      });
    }).catch(function (error) {
      document.getElementById('content-body').innerHTML = '<div class="v2-alert v2-alert--error">' + esc(error.message) + '</div>';
    });
  }

  function termForm(term) {
    var editing = Boolean(term);
    UI.openModal(editing ? 'Sửa thuật ngữ' : 'Thuật ngữ mới',
      '<div class="v2-field"><label for="t-term">Thuật ngữ</label><input id="t-term" value="' + esc(term ? term.term : '') + '"></div>' +
      '<div class="v2-field"><label for="t-domain">Lĩnh vực</label><select id="t-domain">' + domainOptions(term ? term.domain : 'cybersecurity') + '</select></div>' +
      '<div class="v2-field"><label for="t-def">Định nghĩa</label><textarea id="t-def" style="min-height:130px">' + esc(term ? term.definition : '') + '</textarea></div>' +
      '<div class="v2-field"><label for="t-source">URL nguồn (tuỳ chọn)</label><input id="t-source" value="' + esc(term ? term.source_url || '' : '') + '"></div>',
      '<button class="v2-btn" type="button" data-close-modal>Hủy</button><button class="v2-btn v2-btn--primary" type="button" id="save-term">Lưu</button>');
    document.getElementById('save-term').addEventListener('click', function () {
      var body = {
        term: document.getElementById('t-term').value.trim(),
        domain: document.getElementById('t-domain').value,
        definition: document.getElementById('t-def').value.trim(),
        sourceUrl: document.getElementById('t-source').value.trim()
      };
      var request = editing
        ? api('/api/admin/glossary/' + term.id, { method: 'PATCH', body: body })
        : api('/api/admin/glossary', { method: 'POST', body: body });
      request.then(function () {
        UI.closeModal(); BK.toast('Đã lưu thuật ngữ.'); loadGlossary();
      }).catch(function (error) { BK.toast(error.message, 'error'); });
    });
  }

  function loadChemicals() {
    api('/api/admin/chemicals').then(function (payload) {
      var host = document.getElementById('content-body');
      host.innerHTML = toolbar('Hóa chất', 'new-chem', '+ Hồ sơ hóa chất', 'Tìm theo tên hoặc CAS…') +
        '<div class="v2-card"><div class="v2-card__body admin-table-wrap"><table class="admin-table"><thead><tr>' +
        '<th>Tên</th><th>CAS</th><th>Công thức</th><th>Nhóm</th><th>Cập nhật</th><th></th></tr></thead><tbody>' +
        payload.chemicals.map(function (chem) {
          return '<tr><td><strong>' + esc(chem.name) + '</strong></td><td class="v2-mono">' + esc(chem.cas_number || '—') + '</td>' +
            '<td class="v2-mono">' + esc(chem.molecular_formula || '—') + '</td><td>' + esc(chem.category) + '</td>' +
            '<td class="v2-small">' + esc(BK.formatDate(chem.updated_at)) + '</td>' +
            '<td class="actions"><button class="v2-btn v2-btn--sm" type="button" data-edit-chem="' + chem.id + '">Sửa</button>' +
            '<button class="v2-btn v2-btn--sm" type="button" data-delete-chem="' + chem.id + '">Xóa</button></td></tr>';
        }).join('') + '</tbody></table></div></div>';
      document.getElementById('new-chem').addEventListener('click', function () { chemForm(null); });
      document.getElementById('content-search-btn').addEventListener('click', function () {
        var q = document.getElementById('content-search').value.trim();
        api('/api/admin/chemicals' + (q ? '?q=' + encodeURIComponent(q) : '')).then(function (data) {
          var body = document.querySelector('#content-body table tbody');
          if (!body) return;
          body.innerHTML = data.chemicals.map(function (chem) {
            return '<tr><td><strong>' + esc(chem.name) + '</strong></td><td class="v2-mono">' + esc(chem.cas_number || '—') + '</td>' +
              '<td class="v2-mono">' + esc(chem.molecular_formula || '—') + '</td><td>' + esc(chem.category) + '</td>' +
              '<td class="v2-small">' + esc(BK.formatDate(chem.updated_at)) + '</td>' +
              '<td class="actions"><button class="v2-btn v2-btn--sm" type="button" data-edit-chem="' + chem.id + '">Sửa</button>' +
              '<button class="v2-btn v2-btn--sm" type="button" data-delete-chem="' + chem.id + '">Xóa</button></td></tr>';
          }).join('') || '<tr><td colspan="6" class="admin-empty">Không có kết quả.</td></tr>';
        });
      });
    }).catch(function (error) {
      document.getElementById('content-body').innerHTML = '<div class="v2-alert v2-alert--error">' + esc(error.message) + '</div>';
    });
  }

  function chemForm(chem) {
    var editing = Boolean(chem);
    function input(id, label, key, rows) {
      var value = chem ? chem[key] || '' : '';
      return '<div class="v2-field"><label for="' + id + '">' + label + '</label>' +
        (rows ? '<textarea id="' + id + '" style="min-height:' + rows + 'px">' + esc(value) + '</textarea>'
          : '<input id="' + id + '" value="' + esc(value) + '">') + '</div>';
    }
    UI.openModal(editing ? 'Sửa hồ sơ hóa chất' : 'Hồ sơ hóa chất mới',
      '<div class="v2-form-row">' + input('c-name', 'Tên', 'name') + input('c-cas', 'CAS', 'cas_number') + '</div>' +
      '<div class="v2-form-row">' + input('c-formula', 'Công thức', 'molecular_formula') +
        '<div class="v2-field"><label for="c-category">Nhóm</label><select id="c-category">' +
        ['industrial', 'household', 'heavy-metal', 'natural-toxin', 'biological-toxin', 'food-contaminant', 'agricultural', 'environmental', 'pharmaceutical', 'occupational', 'forensic'].map(function (category) {
          return '<option value="' + category + '"' + (chem && chem.category === category ? ' selected' : '') + '>' + category + '</option>';
        }).join('') + '</select></div></div>' +
      input('c-common', 'Tên thông dụng', 'common_names') +
      input('c-description', 'Mô tả', 'description', 70) +
      input('c-hazards', 'Nguy cơ', 'hazards', 70) +
      input('c-exposure', 'Đường phơi nhiễm', 'exposure_routes', 60) +
      input('c-health', 'Ảnh hưởng sức khỏe', 'health_effects', 70) +
      input('c-prevention', 'Phòng ngừa', 'prevention', 70) +
      input('c-response', 'Ứng phó', 'response', 70) +
      input('c-source', 'URL nguồn', 'source_url') +
      '<div class="admin-hint">Không nhập liều gây chết, công thức điều chế hoặc hướng dẫn sử dụng gây hại.</div>',
      '<button class="v2-btn" type="button" data-close-modal>Hủy</button><button class="v2-btn v2-btn--primary" type="button" id="save-chem">Lưu</button>');
    document.getElementById('save-chem').addEventListener('click', function () {
      var body = {
        name: document.getElementById('c-name').value.trim(),
        cas_number: document.getElementById('c-cas').value.trim(),
        molecular_formula: document.getElementById('c-formula').value.trim(),
        category: document.getElementById('c-category').value,
        common_names: document.getElementById('c-common').value.trim(),
        description: document.getElementById('c-description').value.trim(),
        hazards: document.getElementById('c-hazards').value.trim(),
        exposure_routes: document.getElementById('c-exposure').value.trim(),
        health_effects: document.getElementById('c-health').value.trim(),
        prevention: document.getElementById('c-prevention').value.trim(),
        response: document.getElementById('c-response').value.trim(),
        source_url: document.getElementById('c-source').value.trim()
      };
      var request = editing
        ? api('/api/admin/chemicals/' + chem.id, { method: 'PATCH', body: body })
        : api('/api/admin/chemicals', { method: 'POST', body: body });
      request.then(function () {
        UI.closeModal(); BK.toast('Đã lưu hồ sơ.'); loadChemicals();
      }).catch(function (error) { BK.toast(error.message, 'error'); });
    });
  }

  function editChemical(id) {
    BK.api('/api/chemicals/' + id).then(function (payload) {
      chemForm(payload.chemical);
    }).catch(function (error) { BK.toast(error.message, 'error'); });
  }

  // ----- Import JSON -----
  function loadImport() {
    document.getElementById('content-body').innerHTML =
      '<div class="v2-card"><div class="v2-card__body">' +
        '<div class="v2-form-row"><div class="v2-field"><label for="import-type">Loại dữ liệu</label>' +
        '<select id="import-type"><option value="glossary">Thuật ngữ</option><option value="chemicals">Hóa chất</option></select></div>' +
        '<div class="v2-field"><label for="import-file">Tệp JSON (tuỳ chọn)</label><input id="import-file" type="file" accept="application/json"></div></div>' +
        '<div class="v2-field"><label for="import-json">Dữ liệu JSON</label><textarea id="import-json" style="min-height:240px" placeholder=\'[{"term":"Ví dụ","definition":"Định nghĩa","domain":"safety"}]\'></textarea>' +
        '<div class="admin-hint">Tối đa 500 bản ghi mỗi lần. Thuật ngữ cần term, definition, domain; hóa chất cần name và các trường tùy chọn. Tệp CSV cần chuyển sang JSON trước.</div></div>' +
        '<button class="v2-btn v2-btn--primary" type="button" id="import-submit">Nhập dữ liệu</button>' +
      '</div></div>';
    document.getElementById('import-file').addEventListener('change', function (event) {
      var file = event.target.files[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) { BK.toast('Tệp quá lớn (giới hạn 2 MB).', 'error'); return; }
      var reader = new FileReader();
      reader.onload = function () { document.getElementById('import-json').value = String(reader.result || ''); };
      reader.readAsText(file);
    });
    document.getElementById('import-submit').addEventListener('click', function () {
      var items;
      try {
        items = JSON.parse(document.getElementById('import-json').value);
      } catch (error) {
        BK.toast('JSON không hợp lệ.', 'error');
        return;
      }
      if (!Array.isArray(items)) { BK.toast('JSON phải là một mảng bản ghi.', 'error'); return; }
      api('/api/admin/import', {
        method: 'POST',
        body: { type: document.getElementById('import-type').value, items: items }
      }).then(function (payload) {
        BK.toast('Đã nhập ' + payload.imported + ' bản ghi.');
        load('glossary');
      }).catch(function (error) { BK.toast(error.message, 'error'); });
    });
  }

  function load(tab) {
    currentTab = tab;
    document.querySelectorAll('#content-tabs button').forEach(function (button) {
      button.classList.toggle('active', button.getAttribute('data-tab') === tab);
    });
    if (tab === 'articles') loadArticles();
    else if (tab === 'glossary') loadGlossary();
    else if (tab === 'chemicals') loadChemicals();
    else if (tab === 'import') loadImport();
  }

  document.getElementById('content-tabs').addEventListener('click', function (event) {
    var button = event.target.closest('button[data-tab]');
    if (button) load(button.getAttribute('data-tab'));
  });

  document.getElementById('content-body').addEventListener('click', function (event) {
    var edit = event.target.closest('[data-edit-article]');
    if (edit) return editArticle(edit.getAttribute('data-edit-article'));
    var del = event.target.closest('[data-delete-article]');
    if (del) return deleteArticle(del.getAttribute('data-delete-article'));
    var editTerm = event.target.closest('[data-edit-term]');
    if (editTerm) {
      var termId = editTerm.getAttribute('data-edit-term');
      api('/api/admin/glossary').then(function (payload) {
        var term = payload.glossary.find(function (item) { return String(item.id) === String(termId); });
        if (!term) { BK.toast('Không tìm thấy thuật ngữ.', 'error'); return; }
        termForm(term);
      });
      return;
    }
    var delTerm = event.target.closest('[data-delete-term]');
    if (delTerm) {
      if (!window.confirm('Xóa thuật ngữ này?')) return;
      api('/api/admin/glossary/' + delTerm.getAttribute('data-delete-term'), { method: 'DELETE' })
        .then(function () { BK.toast('Đã xóa thuật ngữ.'); loadGlossary(); })
        .catch(function (error) { BK.toast(error.message, 'error'); });
      return;
    }
    var editChem = event.target.closest('[data-edit-chem]');
    if (editChem) return editChemical(editChem.getAttribute('data-edit-chem'));
    var delChem = event.target.closest('[data-delete-chem]');
    if (delChem) {
      if (!window.confirm('Xóa hồ sơ hóa chất này?')) return;
      api('/api/admin/chemicals/' + delChem.getAttribute('data-delete-chem'), { method: 'DELETE' })
        .then(function () { BK.toast('Đã xóa hồ sơ.'); loadChemicals(); })
        .catch(function (error) { BK.toast(error.message, 'error'); });
    }
  });

  window.AdminContent = { load: load, currentTab: function () { return currentTab; } };
})();
