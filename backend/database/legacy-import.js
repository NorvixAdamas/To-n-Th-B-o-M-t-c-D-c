import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/config.js';
import { stripHtml, normalizeVi } from '../utils/text.js';

const GROUP_DOMAINS = [
  { match: 'an ninh mạng', domain: 'cybersecurity' },
  { match: 'độc học', domain: 'toxicology' },
  { match: 'chống vũ khí', domain: 'weapons' },
  { match: 'an toàn đời sống', domain: 'safety' }
];

function domainForHeading(heading) {
  const normalized = normalizeVi(heading);
  for (const group of GROUP_DOMAINS) {
    if (normalized.includes(normalizeVi(group.match))) return group.domain;
  }
  return null;
}

/**
 * Đọc glossary.html của phiên bản 1.0 và trả về danh sách thuật ngữ.
 * Không sửa đổi file nguồn; chỉ đọc để nhập vào CSDL.
 */
export function readLegacyGlossary() {
  const file = path.join(config.root, 'glossary.html');
  if (!fs.existsSync(file)) {
    throw new Error(`Không tìm thấy glossary.html tại ${file}`);
  }
  const html = fs.readFileSync(file, 'utf8');
  const sections = html.split(/(?=<h2[\s>])/i);
  const terms = [];
  let order = 0;

  for (const section of sections) {
    const headingMatch = section.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    if (!headingMatch) continue;
    const domain = domainForHeading(stripHtml(headingMatch[1]));
    if (!domain) continue;

    const pattern = /<dt>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/gi;
    let match;
    while ((match = pattern.exec(section)) !== null) {
      const term = stripHtml(match[1]);
      const definition = stripHtml(match[2]);
      if (!term || !definition) continue;
      order += 1;
      terms.push({
        term,
        definition,
        domain,
        legacyIndex: order,
        searchNorm: normalizeVi(`${term} ${definition}`)
      });
    }
  }
  return terms;
}

export function legacyGlossaryCount() {
  return readLegacyGlossary().length;
}
