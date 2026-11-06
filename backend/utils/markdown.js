import { escapeHtml } from './text.js';

function inline(text) {
  return text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, url) => {
      const decoded = url.replace(/&amp;/g, '&');
      try {
        const parsed = new URL(decoded);
        if (!['http:', 'https:'].includes(parsed.protocol)) return label;
        return `<a href="${escapeHtml(parsed.href)}" rel="noopener noreferrer" target="_blank">${label}</a>`;
      } catch {
        return label;
      }
    });
}

/**
 * Markdown tối giản, an toàn XSS: escape toàn bộ đầu vào, chỉ hỗ trợ
 * heading, đoạn văn, danh sách, trích dẫn, code inline, bold/italic/link http(s).
 */
export function renderMarkdown(markdown) {
  const lines = escapeHtml(String(markdown || '')).replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let listType = null;
  let paragraph = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      html.push(`<p>${inline(paragraph.join(' '))}</p>`);
      paragraph = [];
    }
  };
  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushParagraph();
      closeList();
      continue;
    }
    const heading = line.match(/^(#{2,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = Math.min(4, heading[1].length);
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      flushParagraph();
      if (listType !== 'ul') {
        closeList();
        html.push('<ul>');
        listType = 'ul';
      }
      html.push(`<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`);
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      flushParagraph();
      if (listType !== 'ol') {
        closeList();
        html.push('<ol>');
        listType = 'ol';
      }
      html.push(`<li>${inline(line.replace(/^\d+\.\s+/, ''))}</li>`);
      continue;
    }
    if (line.startsWith('&gt; ')) {
      flushParagraph();
      closeList();
      html.push(`<blockquote>${inline(line.slice(5))}</blockquote>`);
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  closeList();
  return html.join('\n');
}
