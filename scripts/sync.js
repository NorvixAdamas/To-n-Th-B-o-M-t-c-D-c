import { runSyncMany, syncableSources } from '../backend/services/sync.js';

const args = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
const available = syncableSources().map((s) => s.source_key);

if (args.length && args.some((key) => !available.includes(key))) {
  console.error('Nguồn không hợp lệ. Các nguồn có connector:');
  console.error(available.join(', '));
  process.exit(1);
}

const results = await runSyncMany(args);
let failed = 0;
for (const result of results) {
  const counts = result.status === 'success'
    ? `fetched=${result.fetched || 0} inserted=${result.inserted || 0} updated=${result.updated || 0}`
    : '';
  console.log(`[${result.status}] ${result.sourceKey} ${counts}${result.message ? ` — ${result.message}` : ''}`);
  if (result.status === 'error') failed += 1;
}
console.log(`\nTổng: ${results.length} nguồn, lỗi: ${failed}.`);
process.exit(failed ? 1 : 0);
