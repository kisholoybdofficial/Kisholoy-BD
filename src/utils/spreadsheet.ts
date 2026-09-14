/**
 * Dependency-free spreadsheet reading and writing (XLSX + CSV/TSV).
 *
 * Why this exists — and why `xlsx` no longer does:
 * `xlsx@0.18.5` was the final release published to npm. Its prototype-pollution
 * (GHSA-4r6h-fhg6-q94q) and formula-injection advisories were never fixed there;
 * the maintainer moved distribution to their own CDN. This app used it to parse
 * *operator-uploaded* workbooks in the browser, i.e. attacker-controlled bytes
 * fed into a zip + XML parser with a known escalation path. `npm audit fix`
 * cannot resolve it — there is no fixed version on the registry.
 *
 * So: OOXML (SpreadsheetML) is a zip of XML parts, and CSV is a text format.
 * Both are small enough to implement directly, and `fflate` (MIT, 8 kB gzip, no
 * known advisories) does the deflate part. No third-party code touches untrusted
 * input any more, and the client bundle gets ~400 kB lighter.
 *
 * Deliberate hardening:
 *   - every text cell is XML-escaped, so a product title containing `<` or `&`
 *     cannot break out of the sheet part (the classic XXE-adjacent breakage);
 *   - exported text cells that begin with `=`, `+`, `-`, `@`, tab or CR are
 *     neutralised with a leading apostrophe, because Excel/Sheets evaluate a
 *     leading `=` as a formula — the CSV-injection class of bug that turns a
 *     customer's order note into `=HYPERLINK(...)` or `=cmd|...`;
 *   - reading is capped (sheets, rows, cells, string length) so a decompression
 *     bomb cannot pin the tab;
 *   - no network, no eval, no `Function`, no external entity resolution.
 *
 * @license Apache-2.0
 */

import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';

/** A spreadsheet grid. `null` is an empty cell. */
export type CellValue = string | number | boolean | null;
export type SheetRows = CellValue[][];

export interface SheetInput {
  name: string;
  rows: SheetRows;
  /** Column widths in characters (Excel `wch`). */
  columnWidths?: number[];
}

export interface ParsedSheet {
  name: string;
  rows: SheetRows;
}

/** Guardrails for untrusted files. */
const MAX_ZIP_BYTES = 25 * 1024 * 1024;
const MAX_XML_CHARS = 40 * 1024 * 1024;
const MAX_SHEETS = 12;
const MAX_ROWS_PER_SHEET = 20000;
const MAX_COLS_PER_ROW = 200;
const MAX_CELL_CHARS = 8000;

/** Excel refuses these in a sheet name and caps it at 31 characters. */
export function sanitizeSheetName(name: string, fallback = 'Sheet1'): string {
  const cleaned = (name || '').replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim();
  return (cleaned || fallback).slice(0, 31);
}

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Control characters are illegal in XML 1.0 even when escaped.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

/** 0 → A, 25 → Z, 26 → AA … */
export function columnLabel(index: number): string {
  let n = Math.trunc(index) + 1;
  if (n < 1) n = 1;
  let label = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

/**
 * Spreadsheet formula injection defence for anything Excel will re-open
 * (XLSX *and* CSV both). Values that Excel would evaluate get a leading
 * apostrophe, which the cell displays but does not execute.
 */
export function neutraliseFormula(cell: CellValue): CellValue {
  if (typeof cell !== 'string') return cell;
  const first = cell.charCodeAt(0);
  if (first === 9 || first === 13) return `'${cell}`;
  const head = cell[0];
  if (head === '=' || head === '+' || head === '-' || head === '@') {
    // Leave real numbers ("-42") alone: a leading minus is only dangerous when
    // the remainder is not numeric.
    if (head === '-' && /^-[0-9.]/.test(cell)) return cell;
    return `'${cell}`;
  }
  return cell;
}

const asText = (cell: CellValue): string => {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'number') return Number.isFinite(cell) ? String(cell) : '';
  if (typeof cell === 'boolean') return cell ? 'TRUE' : 'FALSE';
  const text = String(cell);
  return text.length > MAX_CELL_CHARS ? text.slice(0, MAX_CELL_CHARS) : text;
};

// ── Writing ─────────────────────────────────────────────────────────────────

function sheetXml(rows: SheetRows, columnWidths: number[] | undefined): string {
  const cols =
    columnWidths && columnWidths.length
      ? `<cols>${columnWidths
          .map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(8, Math.round(width))}" customWidth="1"/>`)
          .join('')}</cols>`
      : '';

  const body: string[] = [];
  rows.slice(0, MAX_ROWS_PER_SHEET).forEach((row, r) => {
    const cells: string[] = [];
    row.slice(0, MAX_COLS_PER_ROW).forEach((raw, c) => {
      const cell = neutraliseFormula(raw);
      const ref = `${columnLabel(c)}${r + 1}`;
      if (cell === null || cell === '' || cell === undefined) return;
      if (typeof cell === 'number') {
        cells.push(`<c r="${ref}"><v>${cell}</v></c>`);
      } else if (typeof cell === 'boolean') {
        cells.push(`<c r="${ref}" t="b"><v>${cell ? 1 : 0}</v></c>`);
      } else {
        cells.push(`<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(cell))}</t></is></c>`);
      }
    });
    body.push(`<row r="${r + 1}">${cells.join('')}</row>`);
  });

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `${cols}<sheetData>${body.join('')}</sheetData></worksheet>`
  );
}

/** Builds a real `.xlsx` (OOXML) workbook from in-memory rows. */
export function buildXlsx(sheets: SheetInput[]): Uint8Array {
  const list = sheets.length ? sheets : [{ name: 'Sheet1', rows: [] }];
  const names = list.map((s, i) => sanitizeSheetName(s.name || `Sheet${i + 1}`, `Sheet${i + 1}`));

  const entries: Record<string, Uint8Array> = {};
  entries['[Content_Types].xml'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      list
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
        )
        .join('') +
      '</Types>'
  );

  entries['_rels/.rels'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>'
  );

  entries['xl/workbook.xml'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      names
        .map((name, i) => `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('') +
      '</sheets></workbook>'
  );

  entries['xl/_rels/workbook.xml.rels'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      list
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
        )
        .join('') +
      '</Relationships>'
  );

  list.forEach((sheet, i) => {
    entries[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(sheet.rows, sheet.columnWidths));
  });

  return zipSync(entries, { level: 6 });
}

/** `objectsToXlsx` — the shape the admin exports actually have: flat records. */
export function recordsToXlsx(
  records: Array<Record<string, any>>,
  options: { sheetName?: string; fileName?: string } = {}
): { bytes: Uint8Array; fileName: string } {
  const headers = headersOf(records);
  const rows: SheetRows = [headers, ...records.map((row) => headers.map((h) => toCell(row[h])))];
  return {
    bytes: buildXlsx([
      {
        name: options.sheetName || 'KISHOLOY_Data',
        rows,
        columnWidths: headers.map((h) => Math.max(h.length + 4, 16)),
      },
    ]),
    fileName: options.fileName || `Kisholoy_Report_${new Date().toISOString().slice(0, 10)}.xlsx`,
  };
}

export function headersOf(records: Array<Record<string, any>>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const record of records) {
    for (const key of Object.keys(record || {})) {
      if (!seen.has(key)) {
        seen.add(key);
        out.push(key);
      }
    }
  }
  return out;
}

const toCell = (value: unknown): CellValue => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

// ── Reading ─────────────────────────────────────────────────────────────────

/** All `<tag ...>text</tag>` inner texts, tolerant of attributes and nesting. */
function innerTexts(xml: string, tag: string): string[] {
  const out: string[] = [];
  const open = new RegExp(`<${tag}(?:\\s[^>]*)?>`, 'g');
  let match: RegExpExecArray | null;
  while ((match = open.exec(xml)) !== null) {
    const from = match.index + match[0].length;
    const close = xml.indexOf(`</${tag}>`, from);
    if (close === -1) continue;
    out.push(decodeEntities(xml.slice(from, close).replace(/<[^>]*>/g, '')));
    open.lastIndex = close;
  }
  return out;
}

const decodeEntities = (value: string): string =>
  value
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => {
      const code = parseInt(hex, 16);
      return code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);/g, (_m, dec: string) => {
      const code = parseInt(dec, 10);
      return code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/** `A12` → column index 0, row index 11. Missing refs fall back to sequential. */
function refToIndexes(ref: string): { row: number; col: number } | null {
  const match = /^([A-Z]+)(\d+)$/.exec(ref.toUpperCase());
  if (!match) return null;
  let col = 0;
  for (const ch of match[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: parseInt(match[2], 10) - 1, col: col - 1 };
}

function parseSheetXml(xml: string, shared: string[]): SheetRows {
  const rows: SheetRows = [];
  const rowRe = /<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;
  let sequential = 0;

  while ((rowMatch = rowRe.exec(xml)) !== null && rows.length < MAX_ROWS_PER_SHEET) {
    const rowIndexAttr = /<row[^>]*\br="(\d+)"/.exec(rowMatch[0]);
    const rowIndex = rowIndexAttr ? parseInt(rowIndexAttr[1], 10) - 1 : sequential;
    sequential = rowIndex + 1;

    const cells: CellValue[] = [];
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch: RegExpExecArray | null;
    let cursor = 0;

    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null && cells.length < MAX_COLS_PER_ROW * 3) {
      const attrs = cellMatch[1] || '';
      const inner = cellMatch[2] || '';
      const refMatch = /\br="([A-Z]+\d+)"/.exec(attrs);
      const where = refMatch ? refToIndexes(refMatch[1]) : null;
      const col = where ? where.col : cursor;
      cursor = col + 1;

      const typeMatch = /\bt="([^"]+)"/.exec(attrs);
      const type = typeMatch ? typeMatch[1] : '';
      const valueMatch = /<v>([\s\S]*?)<\/v>/.exec(inner);
      const inline = innerTexts(inner, 't').join('');

      let value: CellValue = null;
      if (type === 's') {
        const idx = valueMatch ? parseInt(valueMatch[1], 10) : NaN;
        value = Number.isFinite(idx) ? shared[idx] ?? '' : '';
      } else if (type === 'inlineStr') {
        value = inline;
      } else if (type === 'str') {
        value = valueMatch ? decodeEntities(valueMatch[1]) : '';
      } else if (type === 'b') {
        value = valueMatch?.[1] === '1' || valueMatch?.[1] === 'true';
      } else if (type === 'e') {
        value = null; // error cell: treat as blank rather than propagating #REF!
      } else if (valueMatch) {
        const raw = decodeEntities(valueMatch[1]).trim();
        value = raw === '' ? null : Number.isFinite(Number(raw)) && /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(raw) ? Number(raw) : raw;
      }
      if (typeof value === 'string' && value.length > MAX_CELL_CHARS) value = value.slice(0, MAX_CELL_CHARS);

      while (cells.length < col) cells.push(null);
      cells.push(value);
    }

    while (rows.length < rowIndex) rows.push([]);
    rows.push(cells);
  }
  return rows;
}

/** Sheet order from `workbook.xml`, resolved through the relationship part. */
function sheetFilesFrom(zip: Record<string, Uint8Array>): string[] {
  const read = (name: string): string => {
    const entry = zip[name];
    if (!entry) return '';
    const text = strFromU8(entry);
    return text.length > MAX_XML_CHARS ? text.slice(0, MAX_XML_CHARS) : text;
  };

  const workbook = read('xl/workbook.xml');
  const rels = read('xl/_rels/workbook.xml.rels');
  if (!workbook) {
    const fallback = Object.keys(zip)
      .filter((k) => /^xl\/worksheets\/[^/]+\.xml$/i.test(k))
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    return fallback.slice(0, MAX_SHEETS);
  }

  const relMap = new Map<string, string>();
  const relRe = /<Relationship\b[^>]*>/g;
  let rel: RegExpExecArray | null;
  while ((rel = relRe.exec(rels)) !== null) {
    const id = /\bId="([^"]+)"/.exec(rel[0])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(rel[0])?.[1];
    const mode = /\bTargetMode="([^"]+)"/i.exec(rel[0])?.[1];
    // External targets are a request the app would otherwise make on the
    // operator's behalf — never followed.
    if (id && target && mode !== 'External') relMap.set(id, target.replace(/^\/?xl\//, 'xl/').replace(/^([^/])/, 'xl/$1'));
  }

  const files: string[] = [];
  const sheetRe = /<sheet\b[^>]*>/g;
  let sheetMatch: RegExpExecArray | null;
  while ((sheetMatch = sheetRe.exec(workbook)) !== null && files.length < MAX_SHEETS) {
    const rid = /\br:id="([^"]+)"/.exec(sheetMatch[0])?.[1] || /\bId="([^"]+)"/.exec(sheetMatch[0])?.[1];
    const name = /\bname="([^"]*)"/.exec(sheetMatch[0])?.[1] || '';
    const hidden = /\bstate="(hidden|veryHidden)"/i.test(sheetMatch[0]);
    const resolved = rid ? relMap.get(rid) : undefined;
    if (resolved && !hidden) files.push(resolved);
  }

  if (!files.length) {
    return Object.keys(zip)
      .filter((k) => /^xl\/worksheets\/[^/]+\.xml$/i.test(k))
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
      .slice(0, MAX_SHEETS);
  }
  return files.filter((f) => zip[f]);
}

/**
 * Parses an `.xlsx` byte stream into sheets. Throws on anything that is not a
 * zip/OOXML package so callers can show a bilingual "save the file as CSV" hint.
 */
export function readXlsx(input: ArrayBuffer | Uint8Array | Buffer): ParsedSheet[] {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length > MAX_ZIP_BYTES) {
    throw new Error('File too large (limit 25 MB). Filter the data before exporting.');
  }
  // ODF/.xls (BIFF8) start differently; only the ZIP central directory is valid.
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    throw new Error('Not a modern Excel workbook (.xlsx). Re-save it as .xlsx or .csv.');
  }

  let zip: Record<string, Uint8Array>;
  try {
    zip = unzipSync(bytes, {
      filter: (file) => {
        const name = file.name.replace(/^\/+/, '');
        if (!/^xl\/(worksheets|sharedStrings)\//i.test(name) && !/^xl\/(sharedStrings|workbook)\.xml$/i.test(name) && !/^xl\/_rels\//i.test(name)) {
          return false;
        }
        // Compressed-size vs uncompressed-size bomb check.
        return file.originalSize <= MAX_XML_CHARS;
      },
    });
  } catch {
    throw new Error('The workbook could not be opened. It may be corrupt or password protected.');
  }

  const sharedSource = zip['xl/sharedStrings.xml'];
  const shared = sharedSource ? innerTexts(strFromU8(sharedSource), 'si') : [];
  // `unzipSync` keys keep the archive's own separators/case; normalise lookup.
  const normalised: Record<string, Uint8Array> = {};
  for (const key of Object.keys(zip)) normalised[key.replace(/^\/+/, '')] = zip[key];

  const files = sheetFilesFrom(normalised);
  const sheetNames: string[] = [];
  const workbook = normalised['xl/workbook.xml'];
  if (workbook) {
    const nameRe = /<sheet\b[^>]*\bname="([^"]*)"[^>]*>/g;
    let m: RegExpExecArray | null;
    while ((m = nameRe.exec(strFromU8(workbook))) !== null) sheetNames.push(decodeEntities(m[1]));
  }

  return files.map((file, index) => ({
    name: sheetNames[index] || file.split('/').pop()!.replace(/\.xml$/i, ''),
    rows: parseSheetXml(strFromU8(normalised[file]), shared),
  }));
}

// ── CSV ─────────────────────────────────────────────────────────────────────

/** RFC 4180 writer. `includeBom` keeps Bangla readable when Excel double-clicks it. */
export function toCsv(rows: SheetRows, options: { includeBom?: boolean; newline?: string } = {}): string {
  const newline = options.newline ?? '\r\n';
  const line = (cells: CellValue[]): string =>
    cells
      .map((raw) => {
        const cell = neutraliseFormula(raw);
        const text = asText(cell);
        return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
      })
      .join(',');
  const body = rows.map(line).join(newline);
  return (options.includeBom ? '\uFEFF' : '') + body + (rows.length ? newline : '');
}

export function recordsToCsv(
  records: Array<Record<string, any>>,
  options: { fileName?: string } = {}
): { csv: string; fileName: string } {
  const headers = headersOf(records);
  const rows: SheetRows = [headers, ...records.map((record) => headers.map((h) => toCell(record[h])))];
  return {
    csv: toCsv(rows, { includeBom: true }),
    fileName: options.fileName || `Kisholoy_Data_${new Date().toISOString().slice(0, 10)}.csv`,
  };
}

/** RFC 4180 reader: quoted fields, doubled quotes, CRLF, BOM, `,` `;` or tab. */
export function parseDelimited(text: string, delimiter?: string): SheetRows {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const sep = delimiter || detectDelimiter(normalized.split('\n', 1)[0] || '');
  const rows: SheetRows = [];
  let row: CellValue[] = [];
  let field = '';
  let quoted = false;
  let i = 0;

  const endField = () => {
    row.push(field === '' ? null : field);
    field = '';
  };
  const endRow = () => {
    endField();
    if (row.some((c) => c !== null && c !== '')) {
      if (rows.length < MAX_ROWS_PER_SHEET) rows.push(row);
    }
    row = [];
  };

  while (i < normalized.length && rows.length <= MAX_ROWS_PER_SHEET) {
    const ch = normalized[i];
    if (quoted) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field === '') {
      quoted = true;
      i += 1;
      continue;
    }
    if (ch === sep) {
      endField();
      i += 1;
      continue;
    }
    if (ch === '\n') {
      endRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field !== '' || row.length) endRow();

  // Trim stray trailing empties produced by a trailing delimiter.
  return rows.map((cells) => {
    let end = cells.length;
    while (end > 0 && (cells[end - 1] === null || cells[end - 1] === '')) end -= 1;
    return cells.slice(0, end);
  });
}

function detectDelimiter(firstLine: string): string {
  const counts: Array<[string, number]> = [
    [',', (firstLine.match(/,/g) || []).length],
    ['\t', (firstLine.match(/\t/g) || []).length],
    [';', (firstLine.match(/;/g) || []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

/** Turns a grid into header-keyed records, mirroring `XLSX.utils.sheet_to_json`. */
export function rowsToRecords(rows: SheetRows): { records: Array<Record<string, CellValue | number>>; headers: string[] } {
  if (!rows.length) return { records: [], headers: [] };
  const headers = (rows[0] || []).map((cell, index) => asText(cell).trim() || `Column ${index + 1}`);
  const records = rows.slice(1).map((row) => {
    const record: Record<string, CellValue | number> = {};
    headers.forEach((header, index) => {
      const raw = row[index];
      if (typeof raw === 'string') {
        const trimmed = raw.trim();
        record[header] = trimmed !== '' && /^-?\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : raw;
      } else {
        record[header] = raw === undefined ? null : raw;
      }
    });
    return record;
  });
  return { records, headers };
}

/** Triggers a browser download of generated bytes without a server round-trip. */
export function downloadBytes(fileName: string, bytes: Uint8Array, mime: string): void {
  if (typeof document === 'undefined') return;
  const copy = new Uint8Array(bytes); // hand Blob its own buffer
  const blob = new Blob([copy.buffer as ArrayBuffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Revoke on the next tick so the download has latched the object URL.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadText(fileName: string, text: string, mime: string): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
