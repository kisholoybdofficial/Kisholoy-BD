/**
 * Spreadsheet codec tests (`src/utils/spreadsheet.ts`).
 *
 * These replaced the `xlsx` dependency: the checks below are what make it safe
 * to parse an operator-uploaded workbook with code we own. Interop is proven in
 * both directions — our writer's bytes are read back by us, and a workbook
 * produced by a reference implementation (`tests/fixtures/real-world-spreadsheet.xlsx`,
 * written by SheetJS and committed as a fixture) is read by our reader.
 *
 * Run: npm test
 *
 * @license Apache-2.0
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildXlsx,
  columnLabel,
  neutraliseFormula,
  parseDelimited,
  readXlsx,
  recordsToCsv,
  recordsToXlsx,
  rowsToRecords,
  sanitizeSheetName,
  toCsv,
} from '../src/utils/spreadsheet';

const here = path.dirname(fileURLToPath(import.meta.url));

const records = [
  { Order: 'ORD-0001', Customer: 'মুনতাসির শিহাব', Note: 'Deliver after 5pm', Amount: 1250.5, Paid: true },
  { Order: 'ORD-0002', Customer: 'Aisha "AK" Rahman', Note: '=1+1', Amount: 0, Paid: false },
  { Order: 'ORD-0003', Customer: '<script>alert(1)</script> & sons', Note: 'line1\nline2; semicolon', Amount: -42, Paid: true },
  { Order: 'ORD-0004', Customer: '+HYPERLINK("http://evil")', Note: '@SUM(A1)', Amount: 99999, Paid: false },
];

test('xlsx round-trip keeps shape, text and numbers', () => {
  const bytes = buildXlsx([{ name: 'Data', rows: [Object.keys(records[0]), ...records.map((r) => Object.values(r))] }]);
  const sheets = readXlsx(bytes);

  assert.equal(sheets.length, 1);
  assert.equal(sheets[0].name, 'Data');
  assert.deepEqual(sheets[0].rows[0], ['Order', 'Customer', 'Note', 'Amount', 'Paid']);
  assert.equal(sheets[0].rows[1][1], 'মুনতাসির শিহাব', 'Bengali must survive the XML round trip');
  assert.equal(sheets[0].rows[3][1], '<script>alert(1)</script> & sons', 'markup must stay inert text');
  assert.equal(sheets[0].rows[3][2], 'line1\nline2; semicolon', 'newlines inside a cell must survive');
  assert.equal(sheets[0].rows[1][3], 1250.5, 'numbers must come back as numbers');
  assert.equal(sheets[0].rows[3][3], -42);
});

test('xlsx package is a real zip with the expected OOXML parts', () => {
  const bytes = buildXlsx([{ name: 'Data', rows: [['a', 1]] }]);
  // Local file header signature PK\x03\x04 — a spreadsheet, not a CSV in a .xlsx name.
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  const asText = new TextDecoder().decode(bytes.slice(0, 4000));
  assert.ok(asText.includes('[Content_Types].xml'));
});

test('formula-bearing cells are neutralised on export but left numeric on import', () => {
  const { bytes } = recordsToXlsx(records, { fileName: 'x.xlsx' });
  const sheets = readXlsx(bytes);
  const { records: out } = rowsToRecords(sheets[0].rows);

  assert.equal(out[1].Note, "'=1+1", 'a stored formula must not be executable');
  assert.equal(String(out[3].Customer).startsWith("'+"), true);
  assert.equal(out[1].Amount, 0, 'a numeric cell is untouched');
});

test('neutraliseFormula covers the CSV-injection alphabet only for text', () => {
  assert.equal(neutraliseFormula('=SUM(1)'), "'=SUM(1)");
  assert.equal(neutraliseFormula('+1'), "'+1");
  assert.equal(neutraliseFormula('@x'), "'@x");
  assert.equal(neutraliseFormula('\tcmd'), "'\tcmd");
  assert.equal(neutraliseFormula('-42'), '-42', 'a negative number is not an attack');
  assert.equal(neutraliseFormula('-cmd|calc'), "'-cmd|calc");
  assert.equal(neutraliseFormula(7), 7);
  assert.equal(neutraliseFormula(true), true);
});

test('sheet names are sanitised to what Excel accepts', () => {
  assert.equal(sanitizeSheetName('Sales [2026]'), 'Sales 2026');
  assert.equal(sanitizeSheetName('Bad:Name/Here*?'), 'Bad Name Here');
  assert.equal(sanitizeSheetName(''.padEnd(80, 'x')).length, 31);
  assert.equal(sanitizeSheetName('', 'Sheet1'), 'Sheet1');
});

test('columnLabel handles more than 26 columns', () => {
  assert.equal(columnLabel(0), 'A');
  assert.equal(columnLabel(25), 'Z');
  assert.equal(columnLabel(26), 'AA');
  assert.equal(columnLabel(51), 'AZ');
  assert.equal(columnLabel(52), 'BA');
});

test('a workbook written by a reference implementation is readable', () => {
  const fixture = path.join(here, 'fixtures', 'real-world-spreadsheet.xlsx');
  const bytes = new Uint8Array(readFileSync(fixture));
  const sheets = readXlsx(bytes);

  assert.equal(sheets.length, 2, 'both visible sheets are discovered through workbook.xml + rels');
  assert.deepEqual(sheets.map((s) => s.name), ['Orders', 'Second']);

  const { records: rows, headers } = rowsToRecords(sheets[0].rows);
  assert.deepEqual(headers, ['Order', 'Customer', 'Note', 'Amount', 'Paid']);
  assert.equal(rows.length, 4);
  // Shared strings are resolved, not dumped as their index.
  assert.equal(rows[3].Note, 'shared-ORD-0004');
  assert.equal(rows[0].Amount, 1250.5);
});

test('csv writer quotes, escapes and keeps Bangla readable in Excel', () => {
  const csv = toCsv([['a', 'b'], ['x,y', 'he said "hi"'], ['মুনতাসির', '']], { includeBom: true });
  assert.ok(csv.startsWith('\uFEFF'), 'BOM so Excel does not mangle UTF-8');
  assert.ok(csv.includes('"x,y"'));
  assert.ok(csv.includes('"he said ""hi"""'));

  const back = parseDelimited(csv);
  assert.equal(back.length, 3);
  assert.equal(back[1][0], 'x,y');
  assert.equal(back[1][1], 'he said "hi"');
});

test('delimited reader sniffs the delimiter and skips a fully blank trailer', () => {
  assert.deepEqual(parseDelimited('a;b;c\n1;2;3')[1], ['1', '2', '3']);
  assert.deepEqual(parseDelimited('a\tb\n1\t2')[0], ['a', 'b']);
  const trailing = parseDelimited('a,b\n1,2\n\n');
  assert.equal(trailing.length, 2);
});

test('rowsToRecords coerces numeric text and names unnamed headers', () => {
  const { records: rows, headers } = rowsToRecords([['Total', ''], ['12.5', 'x'], ['', '']]);
  assert.deepEqual(headers, ['Total', 'Column 2']);
  assert.equal(rows[0].Total, 12.5, 'numeric strings become numbers so reports can do math');
});

test('csv export of records carries the BOM and the file name', () => {
  const { csv, fileName } = recordsToCsv(records, { fileName: 'report.csv' });
  assert.equal(fileName, 'report.csv');
  assert.ok(csv.startsWith('\uFEFF'));
  const firstLine = csv.replace(/^\uFEFF/, '').split('\r\n')[0];
  assert.equal(firstLine, 'Order,Customer,Note,Amount,Paid');
});

test('garbage, truncated files and non-zip spreadsheets fail closed, not loudly', () => {
  for (const junk of [
    new Uint8Array([1, 2, 3, 4, 5]),
    new Uint8Array(0),
    new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0xfe, 0x00, 0x00]),
  ]) {
    assert.throws(() => readXlsx(junk), undefined, 'must throw a readable Error, never crash the tab');
  }

  // The message a human can act on.
  assert.throws(() => readXlsx(new Uint8Array([1, 2, 3, 4, 5])), /\.xlsx|csv|workbook|opened/i);
});

test('oversized uploads are refused before decompression', () => {
  const huge = new Uint8Array(25 * 1024 * 1024 + 10);
  huge[0] = 0x50;
  huge[1] = 0x4b;
  assert.throws(() => readXlsx(huge), /too large/i);
});
