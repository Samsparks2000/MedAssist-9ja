import { parse as parseCsv } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { drugLabel, matchCatalogue, searchDrugs } from '../catalogue/service.js';
import { cleanNafdac, isValidNafdac, NAFDAC_HINT } from './service.js';

export const TEMPLATE_COLUMNS = ['name', 'strength', 'form', 'quantity', 'price', 'batch_no', 'expiry_date', 'reorder_level', 'nafdac_no'] as const;

export const TEMPLATE_CSV =
  TEMPLATE_COLUMNS.join(',') +
  '\nPanadol,500mg,Tablet,240,50,PN2401,2027-06-30,40,A4-1234\nCoartem,80/480mg,Tablet,60,3500,CT118,2027-01-31,10,04-5678\n';

export interface ParsedRow {
  row: number;
  drugId: string;
  drugLabel: string;
  quantity: number;
  price: number;
  batchNo: string;
  expiryDate: string;
  reorderLevel: number;
  /** Null when the sheet left it empty; the route fills it from the facility's records or reports it. */
  nafdacNo: string | null;
}

export interface RowError {
  row: number;
  message: string;
  /** Lets the dashboard offer a one-click fix: "Yes, use it", "Edit date", "Add price". */
  kind?: 'unknown_drug' | 'expired' | 'price' | 'nafdac' | 'other';
  raw?: string;
  suggestion?: { drugId: string; label: string };
  fields?: { drugId: string | null; quantity: number | null; price: number | null; batchNo: string; expiryDate: string | null; reorderLevel: number; nafdacNo: string | null };
}

/** "2027-08-31", "31/08/2027", "08/2027" or "Aug 2027" → ISO date (end of month when no day). */
export function normaliseExpiry(v: string): string | null {
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))) return s;
  let m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/-](\d{4})$/);
  if (m) return endOfMonth(Number(m[2]), Number(m[1]));
  const d = Date.parse(`1 ${s}`);
  if (/^[a-z]{3,9}\s+\d{4}$/i.test(s) && !Number.isNaN(d)) {
    const dt = new Date(d);
    return endOfMonth(dt.getFullYear(), dt.getMonth() + 1);
  }
  return null;
}

function endOfMonth(year: number, month: number): string | null {
  if (month < 1 || month > 12) return null;
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

type Raw = Record<string, unknown>;

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object' && v && 'result' in v) return cellText((v as { result: unknown }).result);
  if (typeof v === 'object' && v && 'text' in v) return String((v as { text: unknown }).text);
  return String(v).trim();
}

async function readRows(buffer: Buffer, filename: string): Promise<Raw[]> {
  if (/\.xlsx$/i.test(filename)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const headers: string[] = [];
    ws.getRow(1).eachCell((cell, col) => (headers[col] = cellText(cell.value).toLowerCase()));
    const rows: Raw[] = [];
    ws.eachRow((row, idx) => {
      if (idx === 1) return;
      const obj: Raw = {};
      headers.forEach((h, col) => h && (obj[h] = row.getCell(col).value));
      rows.push(obj);
    });
    return rows;
  }
  return parseCsv(buffer, { columns: (h: string[]) => h.map((x) => x.trim().toLowerCase()), skip_empty_lines: true, trim: true, bom: true });
}

/** Parses an uploaded stock sheet, matching each row to the drug catalogue (US-16). */
export async function parseStockSheet(buffer: Buffer, filename: string): Promise<{ rows: ParsedRow[]; errors: RowError[] }> {
  let raw: Raw[];
  try {
    raw = await readRows(buffer, filename);
  } catch (e) {
    return { rows: [], errors: [{ row: 0, message: `Could not read the file: ${(e as Error).message}` }] };
  }
  const rows: ParsedRow[] = [];
  const errors: RowError[] = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const [i, r] of raw.entries()) {
    const rowNo = i + 2; // header is row 1
    // Accept the template's names and the plainer ones in the design ("medicine, batch, expiry").
    const get = (...keys: string[]) => keys.map((k) => cellText(r[k])).find((v) => v !== '') ?? '';
    const problems: string[] = [];

    const name = get('name', 'medicine', 'drug');
    const strength = get('strength');
    const form = get('form');
    const quantityText = get('quantity', 'qty', 'packs');
    const quantity = Number(quantityText);
    const priceText = get('price', 'selling_price').replace(/[₦,\s]/g, '');
    const price = Number(priceText);
    const batchNo = get('batch_no', 'batch');
    const expiry = normaliseExpiry(get('expiry_date', 'expiry'));
    const reorderText = get('reorder_level', 'alert_below');
    const reorderLevel = reorderText === '' ? 0 : Number(reorderText);
    const nafdacNo = cleanNafdac(get('nafdac_no', 'nafdac', 'nafdac_number', 'nafdac_reg_no'));
    let kind: RowError['kind'] = 'other';

    if (!name) problems.push('name is required');
    if (!Number.isInteger(quantity) || quantity < 0) problems.push('quantity must be a whole number ≥ 0');
    if (priceText === '') {
      problems.push('Price is missing');
      kind = 'price';
    } else if (!Number.isFinite(price) || price < 0) problems.push('price must be a number ≥ 0');
    if (!batchNo) problems.push('batch_no is required');
    if (!expiry) problems.push('expiry_date must be YYYY-MM-DD or MM/YYYY');
    else if (expiry <= today) {
      problems.push("Already expired. It won't be listed.");
      kind = 'expired';
    }
    if (!Number.isInteger(reorderLevel) || reorderLevel < 0) problems.push('reorder_level must be a whole number ≥ 0');
    const nafdacOk = nafdacNo === null || isValidNafdac(nafdacNo);
    if (!nafdacOk) {
      problems.push(NAFDAC_HINT);
      kind = 'nafdac';
    }

    let drug = null;
    let suggestion: RowError['suggestion'];
    if (name) {
      drug = await matchCatalogue(name, strength || undefined, form || undefined);
      if (!drug) {
        const best = (await searchDrugs(`${name} ${strength}`.trim(), 1))[0] ?? (await searchDrugs(name, 1))[0];
        if (best) {
          suggestion = { drugId: best.id, label: drugLabel(best) };
          problems.push(`Did you mean ${suggestion.label}?`);
        } else {
          problems.push(`"${[name, strength, form].filter(Boolean).join(' ')}" is not in the drug catalogue`);
        }
        kind = 'unknown_drug';
      }
    }

    if (problems.length) {
      errors.push({
        row: rowNo,
        message: problems.join('; '),
        kind: problems.length > 1 ? 'other' : kind,
        raw: [name, strength, form].filter(Boolean).join(' ') + (expiry ? ` · expiry ${expiry}` : '') + (priceText ? '' : ' · price empty'),
        suggestion,
        fields: {
          drugId: drug?.id ?? suggestion?.drugId ?? null,
          quantity: Number.isInteger(quantity) ? quantity : null,
          price: priceText !== '' && Number.isFinite(price) ? price : null,
          batchNo,
          expiryDate: expiry,
          reorderLevel: Number.isInteger(reorderLevel) ? reorderLevel : 0,
          nafdacNo: nafdacOk ? nafdacNo : null,
        },
      });
      continue;
    }
    rows.push({
      row: rowNo,
      drugId: drug!.id,
      drugLabel: [drug!.brand_name, drug!.strength, drug!.form].filter(Boolean).join(' '),
      quantity,
      price,
      batchNo,
      expiryDate: expiry!,
      reorderLevel,
      nafdacNo,
    });
  }
  return { rows, errors };
}
