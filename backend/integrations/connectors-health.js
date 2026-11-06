import { getAll, getOne, run } from '../database/db.js';
import { config } from '../config/config.js';
import { fetchJson, MissingKeyError } from './http.js';
import { upsertDrug, upsertFood, upsertFoodItem, upsertResearch } from './store.js';

const now = () => new Date().toISOString();

function isoDate(value) {
  if (!value) return null;
  const compact = String(value).replace(/\D/g, '');
  if (compact.length === 8) {
    return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}T00:00:00.000Z`;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export async function syncPubchem() {
  const rows = getAll('SELECT id, name, cas_number, pubchem_cid, locked FROM chemicals ORDER BY id');
  let fetched = 0;
  let updated = 0;
  let skipped = 0;
  const errors = [];

  for (const row of rows) {
    if (row.locked) {
      skipped += 1;
      continue;
    }
    const identifier = row.pubchem_cid ? `cid/${encodeURIComponent(row.pubchem_cid)}` : `name/${encodeURIComponent(row.name)}`;
    try {
      const json = await fetchJson(
        `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/${identifier}/property/MolecularFormula,MolecularWeight,IUPACName/JSON`,
        { retries: 1, timeout: 20000 }
      );
      const property = json.PropertyTable?.Properties?.[0];
      if (!property) {
        skipped += 1;
        continue;
      }
      fetched += 1;
      run(
        `UPDATE chemicals SET molecular_formula = COALESCE(?, molecular_formula),
           molecular_weight = COALESCE(?, molecular_weight), iupac_name = COALESCE(?, iupac_name),
           pubchem_cid = COALESCE(?, pubchem_cid), updated_at = ?, search_norm = search_norm || ' ' || ?
         WHERE id = ? AND locked = 0`,
        [
          property.MolecularFormula || null,
          property.MolecularWeight != null ? Number(property.MolecularWeight) : null,
          property.IUPACName || null,
          property.CID ? String(property.CID) : null,
          now(),
          property.MolecularFormula || '',
          row.id
        ]
      );
      updated += 1;
    } catch (error) {
      skipped += 1;
      errors.push(`${row.name}: ${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return {
    fetched, inserted: 0, updated, skipped,
    message: errors.length ? `Một số hồ sơ không tra được: ${errors.slice(0, 3).join(' | ')}` : 'Đã cập nhật công thức và mã PubChem.'
  };
}

export async function syncPubmed() {
  const terms = ['botulinum toxin', 'aflatoxin food', 'lead poisoning children', 'organophosphate poisoning', 'PFAS health'];
  let fetched = 0;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const term of terms) {
    try {
      const search = await fetchJson(
        `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=5&term=${encodeURIComponent(term)}`,
        { timeout: 20000 }
      );
      const ids = search.esearchresult?.idlist || [];
      if (!ids.length) continue;
      const summary = await fetchJson(
        `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(',')}`,
        { timeout: 20000 }
      );
      fetched += ids.length;
      for (const id of ids) {
        const item = summary.result?.[id];
        if (!item || !item.title) {
          skipped += 1;
          continue;
        }
        const authors = (item.authors || []).map((a) => a.name).filter(Boolean).slice(0, 6).join(', ');
        const status = upsertResearch({
          externalId: id,
          title: item.title,
          abstract: '',
          authors: authors || null,
          journal: item.fulljournalname || item.source || null,
          pubDate: item.pubdate || null,
          source: 'pubmed',
          sourceUrl: `https://pubmed.ncbi.nlm.nih.gov/${id}/`
        });
        if (status === 'inserted') inserted += 1; else updated += 1;
      }
    } catch (error) {
      skipped += 1;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  return {
    fetched, inserted, updated, skipped,
    message: 'Chỉ lưu metadata PubMed; tóm tắt/toàn văn thuộc bản quyền tác giả.'
  };
}

export async function syncOpenfdaFood() {
  const params = new URLSearchParams({ limit: '100', sort: 'report_date:desc' });
  if (config.apiKeys.openfda) params.set('api_key', config.apiKeys.openfda);
  const json = await fetchJson(`https://api.fda.gov/food/enforcement.json?${params}`, { timeout: 45000 });
  const items = Array.isArray(json.results) ? json.results : [];
  let inserted = 0;
  let updated = 0;
  for (const item of items) {
    if (!item.recall_number || !item.product_description) continue;
    const status = upsertFood({
      externalId: item.recall_number,
      kind: 'recall',
      product: item.product_description,
      reason: item.reason_for_recall || null,
      company: item.recalling_firm || null,
      distribution: item.distribution_pattern || null,
      classification: item.classification || null,
      country: item.country || null,
      recallDate: isoDate(item.report_date),
      source: 'openfda-food',
      sourceUrl: 'https://open.fda.gov/apis/food/enforcement/',
      license: 'Dữ liệu công khai FDA'
    });
    if (status === 'inserted') inserted += 1; else updated += 1;
  }
  return {
    fetched: items.length, inserted, updated, skipped: 0,
    message: 'Thu hồi thực phẩm của FDA Hoa Kỳ; không phải danh mục đầy đủ của Việt Nam.'
  };
}

export async function syncOpenfdaDrug() {
  const params = new URLSearchParams({ limit: '50', sort: 'effective_time:desc' });
  if (config.apiKeys.openfda) params.set('api_key', config.apiKeys.openfda);
  const json = await fetchJson(`https://api.fda.gov/drug/label.json?${params}`, { timeout: 45000 });
  const items = Array.isArray(json.results) ? json.results : [];
  let inserted = 0;
  let updated = 0;
  for (const item of items) {
    const externalId = item.id || item.set_id;
    if (!externalId) continue;
    const openfda = item.openfda || {};
    const brandName = (openfda.brand_name || [])[0] || null;
    const genericName = (openfda.generic_name || [])[0] || null;
    if (!brandName && !genericName) continue;
    const warnings = (item.warnings || item.boxed_warning || []).join(' ').slice(0, 2000);
    const foodEffect = Array.isArray(item.food_effect) ? item.food_effect.join(' ').slice(0, 800) : null;
    const status = upsertDrug({
      externalId,
      brandName,
      genericName,
      warnings: warnings || null,
      foodEffect,
      source: 'openfda',
      sourceUrl: 'https://open.fda.gov/apis/drug/label/'
    });
    if (status === 'inserted') inserted += 1; else updated += 1;
  }
  return {
    fetched: items.length, inserted, updated, skipped: 0,
    message: 'Chỉ lưu cảnh báo và tương tác thực phẩm; KHÔNG lưu liều dùng hay chỉ định điều trị.'
  };
}

export async function syncUsdaFdc() {
  if (!config.apiKeys.usdaFdc) throw new MissingKeyError('USDA FoodData Central', 'USDA_FDC_API_KEY');
  const queries = ['apple', 'milk', 'rice', 'egg', 'salmon'];
  let fetched = 0;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const keep = ['Energy', 'Protein', 'Total lipid (fat)', 'Carbohydrate, by difference', 'Sodium, Na', 'Sugars, total including NLEA', 'Fiber, total dietary'];

  for (const query of queries) {
    try {
      const json = await fetchJson('https://api.nal.usda.gov/fdc/v1/foods/search', {
        method: 'POST',
        body: { query, pageSize: 3, api_key: config.apiKeys.usdaFdc },
        timeout: 30000
      });
      const foods = Array.isArray(json.foods) ? json.foods : [];
      fetched += foods.length;
      for (const food of foods) {
        if (!food.fdcId) {
          skipped += 1;
          continue;
        }
        const nutrients = (food.foodNutrients || [])
          .filter((n) => keep.includes(n.nutrientName))
          .map((n) => ({ name: n.nutrientName, unit: n.unitName, value: n.value }));
        const status = upsertFoodItem({
          externalId: String(food.fdcId),
          description: food.description,
          dataType: food.dataType || null,
          brandOwner: food.brandOwner || null,
          nutrientsJson: JSON.stringify(nutrients),
          source: 'usda-fdc',
          sourceUrl: `https://fdc.nal.usda.gov/food-details/${food.fdcId}/nutrients`
        });
        if (status === 'inserted') inserted += 1; else updated += 1;
      }
    } catch (error) {
      skipped += 1;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return {
    fetched, inserted, updated, skipped,
    message: 'Dữ liệu thành phần dinh dưỡng Hoa Kỳ; chỉ mang tính tham khảo.'
  };
}

export function foodRecallCount() {
  const row = getOne('SELECT COUNT(*) AS n FROM food_safety');
  return row ? Number(row.n) : 0;
}
