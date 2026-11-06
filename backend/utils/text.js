/**
 * Tiện ích văn bản dùng chung: chuẩn hoá tiếng Việt không dấu, escape HTML,
 * bóc thẻ, slug và trích đoạn kết quả tìm kiếm.
 */

const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”'
};

export function decodeEntities(value) {
  return String(value == null ? '' : value).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code) => {
    const key = String(code).toLowerCase();
    if (key.startsWith('#x')) {
      const n = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : match;
    }
    if (key.startsWith('#')) {
      const n = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : match;
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, key) ? ENTITIES[key] : match;
  });
}

export function stripHtml(value) {
  return decodeEntities(String(value == null ? '' : value).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Chuẩn hoá để tìm kiếm: chữ thường, bỏ dấu, bỏ ký tự đặc biệt, gộp khoảng trắng. */
export function normalizeVi(value) {
  return String(value == null ? '' : value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function slugify(value, fallback = 'bai-viet') {
  const slug = normalizeVi(value).replace(/\s+/g, '-').slice(0, 90);
  return slug || fallback;
}

export function truncate(value, max = 240) {
  const text = String(value == null ? '' : value).trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Trả về đoạn trích quanh vị trí xuất hiện từ khoá (đã bỏ dấu để so khớp). */
export function buildSnippet(text, query, max = 220) {
  const clean = stripHtml(text);
  if (!clean) return '';
  const normalizedQuery = normalizeVi(query);
  if (!normalizedQuery) return truncate(clean, max);

  const normalizedText = normalizeVi(clean);
  const index = normalizedText.indexOf(normalizedQuery);
  if (index < 0) return truncate(clean, max);

  // Vị trí trên chuỗi gốc xấp xỉ vị trí trên chuỗi đã chuẩn hoá; lùi 60 ký tự.
  const start = Math.max(0, index - 60);
  const slice = clean.slice(start, start + max);
  return `${start > 0 ? '…' : ''}${slice.trim()}${start + max < clean.length ? '…' : ''}`;
}

export function isoNow() {
  return new Date().toISOString();
}

export function isoDaysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString();
}

export function parseIntSafe(value, fallback = 0) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function isSafeId(value) {
  return /^[a-z0-9][a-z0-9-]{0,120}$/.test(String(value || ''));
}
