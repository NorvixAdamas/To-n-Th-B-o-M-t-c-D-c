import { getAll } from '../database/db.js';
import { normalizeVi, buildSnippet } from '../utils/text.js';

export const SEARCH_TYPES = {
  article: { label: 'Bài viết', icon: '📄' },
  glossary: { label: 'Thuật ngữ', icon: '📚' },
  chemical: { label: 'Hóa chất', icon: '🧪' },
  vulnerability: { label: 'Lỗ hổng', icon: '🛡' },
  threat: { label: 'Tình báo', icon: '🎯' },
  food: { label: 'An toàn thực phẩm', icon: '🍽' },
  legal: { label: 'Pháp luật', icon: '⚖' },
  protocol: { label: 'Quy trình an toàn', icon: '⛑' },
  weapon: { label: 'Nhận diện vũ khí', icon: '🔎' },
  research: { label: 'Nghiên cứu', icon: '🔬' },
  case: { label: 'Case study', icon: '🗂' }
};

export const DOMAIN_LABELS = {
  cybersecurity: 'An ninh mạng',
  toxicology: 'Độc học',
  'food-safety': 'An toàn thực phẩm',
  weapons: 'Vũ khí & đồ cấm',
  safety: 'An toàn đời sống',
  forensic: 'Pháp y',
  environment: 'Môi trường',
  medical: 'Y khoa',
  legal: 'Pháp luật'
};

function enc(value) {
  return encodeURIComponent(String(value));
}

function hostOf(url) {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Truy vấn tất cả loại nội dung. Mỗi loại tối đa 40 ứng viên; sau đó hợp nhất,
 * tính điểm và lọc chính xác theo loại/nguồn.
 */
export function searchAll(options = {}) {
  const started = Date.now();
  const query = String(options.q || '').trim().slice(0, 200);
  const qn = normalizeVi(query);
  const like = `%${qn}%`;
  const limitPerType = 60;
  const results = [];

  const domain = options.domain && DOMAIN_LABELS[options.domain] ? options.domain : '';
  const from = options.from || '';
  const to = options.to || '';
  const source = String(options.source || '').trim().toLowerCase();

  const dateClause = (column) => {
    const parts = [];
    const params = [];
    if (from) {
      parts.push(`AND ${column} >= ?`);
      params.push(`${from}T00:00:00.000Z`);
    }
    if (to) {
      parts.push(`AND ${column} <= ?`);
      params.push(`${to}T23:59:59.999Z`);
    }
    return { sql: parts.join(' '), params };
  };

  function add(type, rows, mapRow) {
    for (const row of rows) {
      const mapped = mapRow(row);
      if (!mapped || !mapped.title) continue;
      results.push({
        type,
        typeLabel: SEARCH_TYPES[type].label,
        icon: SEARCH_TYPES[type].icon,
        ...mapped,
        sourceHost: hostOf(mapped.sourceUrl)
      });
    }
  }

  // Bài viết
  {
    const d = dateClause('updated_at');
    const rows = getAll(
      `SELECT id, slug, title, summary, domain, path, source_url, verification_status, updated_at
       FROM articles WHERE status = 'published' AND search_norm LIKE ?
       ${domain ? 'AND domain = ?' : ''} ${d.sql} ORDER BY updated_at DESC LIMIT ?`,
      [like, ...(domain ? [domain] : []), ...d.params, limitPerType]
    );
    add('article', rows, (r) => ({
      id: String(r.id), title: r.title, excerpt: r.summary || '',
      domain: r.domain, sourceUrl: r.source_url, verification: r.verification_status,
      date: r.updated_at, url: r.path && r.path.startsWith('/') ? r.path : `/${r.path || ''}`
    }));
  }

  // Thuật ngữ
  {
    const d = dateClause('updated_at');
    const rows = getAll(
      `SELECT id, term, definition, domain, source_url, verification_status, updated_at
       FROM glossary_terms WHERE search_norm LIKE ? ${domain ? 'AND domain = ?' : ''} ${d.sql}
       ORDER BY LENGTH(term) ASC, term ASC LIMIT ?`,
      [like, ...(domain ? [domain] : []), ...d.params, limitPerType]
    );
    add('glossary', rows, (r) => ({
      id: String(r.id), title: r.term, excerpt: r.definition,
      domain: r.domain, sourceUrl: r.source_url, verification: r.verification_status,
      date: r.updated_at, url: `/glossary.html?q=${enc(r.term)}`
    }));
  }

  // Hóa chất
  {
    const d = dateClause('updated_at');
    const rows = getAll(
      `SELECT id, name, cas_number, description, hazards, category, source_url, verification_status, updated_at
       FROM chemicals WHERE search_norm LIKE ? ${domain ? 'AND ? = ?' : ''} ${d.sql}
       ORDER BY name ASC LIMIT ?`,
      [like, ...(domain ? [domain, 'toxicology'] : []), ...d.params, limitPerType]
    );
    add('chemical', rows, (r) => ({
      id: String(r.id), title: r.name,
      excerpt: [r.cas_number ? `CAS ${r.cas_number}` : '', r.description || r.hazards || ''].filter(Boolean).join(' — '),
      domain: 'toxicology', sourceUrl: r.source_url, verification: r.verification_status,
      date: r.updated_at, url: `/chemical.html?id=${r.id}`
    }));
  }

  // Lỗ hổng
  {
    const d = dateClause('COALESCE(modified_at, published_at, updated_at)');
    const rows = getAll(
      `SELECT id, cve_id, title, description, cvss_score, cvss_severity, known_exploited, source_url,
              verification_status, COALESCE(modified_at, published_at, updated_at) AS dt
       FROM vulnerabilities WHERE search_norm LIKE ? ${domain ? 'AND ? = ?' : ''} ${d.sql.replaceAll('COALESCE(modified_at, published_at, updated_at)', 'COALESCE(modified_at, published_at, updated_at)')}
       ORDER BY cvss_score DESC LIMIT ?`,
      [like, ...(domain ? [domain, 'cybersecurity'] : []), ...d.params, limitPerType]
    );
    add('vulnerability', rows, (r) => ({
      id: String(r.id), title: `${r.cve_id} — ${r.title || 'Lỗ hổng phần mềm'}`,
      excerpt: `${r.cvss_severity || ''} ${r.cvss_score != null ? r.cvss_score : ''}`.trim() + (r.description ? ` · ${r.description}` : ''),
      domain: 'cybersecurity', sourceUrl: r.source_url, verification: r.verification_status,
      date: r.dt, url: `/vulnerability.html?id=${enc(r.cve_id)}`,
      badge: r.known_exploited ? 'Đang bị khai thác' : null
    }));
  }

  // Tình báo mối đe dọa
  {
    const d = dateClause('updated_at');
    const rows = getAll(
      `SELECT id, external_id, name, description, tactic, source, source_url, verification_status, updated_at
       FROM threat_intel WHERE search_norm LIKE ? ${domain ? 'AND ? = ?' : ''} ${d.sql}
       ORDER BY updated_at DESC LIMIT ?`,
      [like, ...(domain ? [domain, 'cybersecurity'] : []), ...d.params, limitPerType]
    );
    add('threat', rows, (r) => ({
      id: String(r.id), title: `${r.external_id} — ${r.name}`,
      excerpt: [r.tactic, r.description].filter(Boolean).join(' · '),
      domain: 'cybersecurity', sourceUrl: r.source_url, verification: r.verification_status,
      date: r.updated_at, url: r.source_url
    }));
  }

  // Thu hồi thực phẩm
  {
    const d = dateClause('COALESCE(recall_date, updated_at)');
    const rows = getAll(
      `SELECT id, external_id, product, reason, company, classification, recall_date, source_url, verification_status
       FROM food_safety WHERE search_norm LIKE ? ${domain ? 'AND ? = ?' : ''} ${d.sql}
       ORDER BY COALESCE(recall_date, updated_at) DESC LIMIT ?`,
      [like, ...(domain ? [domain, 'food-safety'] : []), ...d.params, limitPerType]
    );
    add('food', rows, (r) => ({
      id: String(r.id), title: r.product, excerpt: [r.company, r.reason, r.classification].filter(Boolean).join(' · '),
      domain: 'food-safety', sourceUrl: r.source_url, verification: r.verification_status,
      date: r.recall_date, url: r.source_url
    }));
  }

  // Văn bản pháp luật
  {
    const d = dateClause('updated_at');
    const rows = getAll(
      `SELECT id, document_number, title, issuer, summary, source_url, verification_status, updated_at
       FROM legal_documents WHERE search_norm LIKE ? ${domain ? 'AND ? = ?' : ''} ${d.sql}
       ORDER BY issued_year DESC LIMIT ?`,
      [like, ...(domain ? [domain, 'legal'] : []), ...d.params, limitPerType]
    );
    add('legal', rows, (r) => ({
      id: String(r.id), title: `${r.document_number} — ${r.title}`,
      excerpt: [r.issuer, r.summary].filter(Boolean).join(' · '),
      domain: 'legal', sourceUrl: r.source_url, verification: r.verification_status,
      date: r.updated_at, url: r.source_url
    }));
  }

  // Quy trình an toàn
  {
    const d = dateClause('updated_at');
    const rows = getAll(
      `SELECT id, slug, title, summary, audience, source_url, verification_status, updated_at
       FROM safety_protocols WHERE search_norm LIKE ? ${domain ? 'AND ? = ?' : ''} ${d.sql}
       ORDER BY title ASC LIMIT ?`,
      [like, ...(domain ? [domain, 'safety'] : []), ...d.params, limitPerType]
    );
    add('protocol', rows, (r) => ({
      id: String(r.id), title: r.title, excerpt: [r.audience, r.summary].filter(Boolean).join(' · '),
      domain: 'safety', sourceUrl: r.source_url, verification: r.verification_status,
      date: r.updated_at, url: '/safety.html'
    }));
  }

  // Nhận diện vũ khí
  {
    const d = dateClause('updated_at');
    const rows = getAll(
      `SELECT id, name, category, recognition_markers, legal_note, source_url, verification_status, updated_at
       FROM weapons_reference WHERE search_norm LIKE ? ${domain ? 'AND ? = ?' : ''} ${d.sql}
       ORDER BY name ASC LIMIT ?`,
      [like, ...(domain ? [domain, 'weapons'] : []), ...d.params, limitPerType]
    );
    add('weapon', rows, (r) => ({
      id: String(r.id), title: r.name, excerpt: r.recognition_markers,
      domain: 'weapons', sourceUrl: r.source_url, verification: r.verification_status,
      date: r.updated_at, url: '/weapons.html'
    }));
  }

  // Nghiên cứu
  {
    const d = dateClause('updated_at');
    const rows = getAll(
      `SELECT id, external_id, title, abstract, journal, pub_date, source_url, verification_status
       FROM research_articles WHERE search_norm LIKE ? ${domain ? 'AND ? = ?' : ''} ${d.sql}
       ORDER BY COALESCE(pub_date, updated_at) DESC LIMIT ?`,
      [like, ...(domain ? [domain, 'toxicology'] : []), ...d.params, limitPerType]
    );
    add('research', rows, (r) => ({
      id: String(r.id), title: r.title, excerpt: [r.journal, r.abstract].filter(Boolean).join(' · '),
      domain: 'toxicology', sourceUrl: r.source_url, verification: r.verification_status,
      date: r.pub_date, url: r.source_url
    }));
  }

  // Case study
  {
    const d = dateClause('updated_at');
    const rows = getAll(
      `SELECT id, title, summary, findings, year, domain, source_url, verification_status, updated_at
       FROM forensic_cases WHERE search_norm LIKE ? ${domain ? 'AND domain = ?' : ''} ${d.sql}
       ORDER BY year DESC LIMIT ?`,
      [like, ...(domain ? [domain] : []), ...d.params, limitPerType]
    );
    add('case', rows, (r) => ({
      id: String(r.id), title: r.title, excerpt: r.summary,
      domain: r.domain, sourceUrl: r.source_url, verification: r.verification_status,
      date: r.updated_at, url: r.source_url
    }));
  }

  // Lọc theo nguồn (hostname) và tính điểm
  const filteredBySource = source
    ? results.filter((item) => item.sourceHost.toLowerCase().includes(source))
    : results;

  for (const item of filteredBySource) {
    const titleNorm = normalizeVi(item.title);
    let score = 0;
    if (titleNorm === qn) score += 120;
    else if (titleNorm.startsWith(qn)) score += 80;
    else if (titleNorm.includes(qn)) score += 55;
    if (normalizeVi(item.excerpt).includes(qn)) score += 15;
    score += Math.max(0, 15 - (Date.now() - new Date(item.date || 0).getTime()) / (1000 * 3600 * 24 * 30));
    item.score = Math.round(score * 10) / 10;
    item.snippet = buildSnippet(item.excerpt || item.title, query, 220);
  }

  const typeFilter = options.type && SEARCH_TYPES[options.type] ? options.type : '';
  const filteredByType = typeFilter ? filteredBySource.filter((item) => item.type === typeFilter) : filteredBySource;

  const sort = options.sort === 'newest' ? 'newest' : 'relevance';
  filteredByType.sort((a, b) => {
    if (sort === 'newest') return new Date(b.date || 0) - new Date(a.date || 0);
    if (b.score !== a.score) return b.score - a.score;
    return new Date(b.date || 0) - new Date(a.date || 0);
  });

  const typeCounts = {};
  const domainCounts = {};
  const sourceCounts = {};
  for (const item of filteredBySource) {
    typeCounts[item.type] = (typeCounts[item.type] || 0) + 1;
    if (item.domain) domainCounts[item.domain] = (domainCounts[item.domain] || 0) + 1;
    if (item.sourceHost) sourceCounts[item.sourceHost] = (sourceCounts[item.sourceHost] || 0) + 1;
  }

  const page = Math.max(1, Number(options.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(options.limit) || 12));
  const total = filteredByType.length;
  const resultsPage = filteredByType.slice((page - 1) * limit, page * limit);

  return {
    query,
    normalizedQuery: qn,
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
    durationMs: Date.now() - started,
    results: resultsPage,
    facets: {
      types: Object.entries(typeCounts).map(([type, count]) => ({ type, label: SEARCH_TYPES[type].label, count }))
        .sort((a, b) => b.count - a.count),
      domains: Object.entries(domainCounts).map(([key, count]) => ({ key, label: DOMAIN_LABELS[key] || key, count })),
      sources: Object.entries(sourceCounts).map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count).slice(0, 12)
    }
  };
}
