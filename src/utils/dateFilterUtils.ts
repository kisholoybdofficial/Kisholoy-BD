/**
 * @file src/utils/dateFilterUtils.ts
 * @description Advanced Date-wise Filtering, Time Interval Aggregations, Excel/CSV Export & Import Utilities
 * Supports Years, Months, Weeks, Custom Date Ranges, and Bilingual (Bangla/English) formats.
 */

import {
  recordsToXlsx,
  recordsToCsv,
  readXlsx,
  parseDelimited,
  rowsToRecords,
  downloadBytes,
  downloadText
} from './spreadsheet';

export type DateFilterPreset =
  | 'ALL'
  | 'TODAY'
  | 'YESTERDAY'
  | 'THIS_WEEK'
  | 'LAST_2_DAYS'
  | 'LAST_5_DAYS'
  | 'LAST_7_DAYS'
  | 'THIS_MONTH'
  | 'LAST_MONTH'
  | 'LAST_30_DAYS'
  | 'THIS_QUARTER'
  | 'Q1'
  | 'Q2'
  | 'Q3'
  | 'Q4'
  | 'THIS_YEAR'
  | 'LAST_YEAR'
  | 'SPECIFIC_YEAR'
  | 'SPECIFIC_MONTH'
  | 'SPECIFIC_WEEK'
  | 'CUSTOM_RANGE';

export interface DateFilterConfig {
  preset: DateFilterPreset;
  startDate?: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD
  selectedYear?: number;
  selectedMonth?: number; // 0-11 (Jan-Dec)
  selectedWeek?: number;  // 1-53
}

export interface DateRangeBounds {
  start: Date | null;
  end: Date | null;
  labelEn: string;
  labelBn: string;
}

// Bengali month names
export const BANGLA_MONTHS = [
  'জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
  'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'
];

export const ENGLISH_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

// Available years for selection (dynamic list around current year)
export const AVAILABLE_YEARS = [2027, 2026, 2025, 2024, 2023, 2022];

/**
 * Converts English digits to Bangla digits
 */
export function toBanglaDigits(num: number | string): string {
  const banglaDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
  return String(num).replace(/\d/g, (d) => banglaDigits[parseInt(d, 10)]);
}

/**
 * Format a Date object nicely in EN or BN
 */
export function formatDateDisplay(dateInput: string | Date | undefined | null, isBn = false, includeTime = false): string {
  if (!dateInput) return isBn ? 'তারিখ অনুপস্থিত' : 'N/A';
  
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(d.getTime())) return isBn ? 'ভুল তারিখ' : 'Invalid Date';

  const day = d.getDate();
  const monthIdx = d.getMonth();
  const year = d.getFullYear();

  if (isBn) {
    const formattedDate = `${toBanglaDigits(day)} ${BANGLA_MONTHS[monthIdx]}, ${toBanglaDigits(year)}`;
    if (includeTime) {
      const hours = d.getHours();
      const minutes = d.getMinutes().toString().padStart(2, '0');
      const ampm = hours >= 12 ? 'বিকাল/রাত' : 'সকাল';
      const formattedHours = hours % 12 || 12;
      return `${formattedDate} (${ampm} ${toBanglaDigits(formattedHours)}:${toBanglaDigits(minutes)})`;
    }
    return formattedDate;
  }

  const formattedDate = `${day} ${ENGLISH_MONTHS[monthIdx]} ${year}`;
  if (includeTime) {
    const timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    return `${formattedDate}, ${timeStr}`;
  }
  return formattedDate;
}

/**
 * Calculate the exact start and end dates based on filter configuration
 */
export function getDateRangeBounds(config: DateFilterConfig): DateRangeBounds {
  const now = new Date();
  const currentYear = now.getFullYear();

  switch (config.preset) {
    case 'TODAY': {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      return { start, end, labelEn: 'Today', labelBn: 'আজকের দিন' };
    }

    case 'YESTERDAY': {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const start = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 0, 0, 0, 0);
      const end = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59, 999);
      return { start, end, labelEn: 'Yesterday', labelBn: 'গতকালের দিন' };
    }

    case 'THIS_WEEK': {
      // Start from Monday (or Sunday)
      const start = new Date(now);
      const day = start.getDay();
      const diff = start.getDate() - day + (day === 0 ? -6 : 1); // Monday as first day
      start.setDate(diff);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      return { start, end, labelEn: 'This Week', labelBn: 'চলতি সপ্তাহ' };
    }

    case 'LAST_2_DAYS': {
      const start = new Date(now);
      start.setDate(now.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      return { start, end, labelEn: 'Last 2 Days', labelBn: 'বিগত ২ দিন' };
    }

    case 'LAST_5_DAYS': {
      const start = new Date(now);
      start.setDate(now.getDate() - 4);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      return { start, end, labelEn: 'Last 5 Days', labelBn: 'বিগত ৫ দিন' };
    }

    case 'LAST_7_DAYS': {
      const start = new Date(now);
      start.setDate(now.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      return { start, end, labelEn: 'Last 7 Days', labelBn: 'বিগত ৭ দিন' };
    }

    case 'THIS_MONTH': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      return { start, end, labelEn: `${ENGLISH_MONTHS[now.getMonth()]} ${now.getFullYear()}`, labelBn: `${BANGLA_MONTHS[now.getMonth()]} ${toBanglaDigits(now.getFullYear())}` };
    }

    case 'LAST_MONTH': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      const mIdx = start.getMonth();
      const yr = start.getFullYear();
      return { start, end, labelEn: `${ENGLISH_MONTHS[mIdx]} ${yr}`, labelBn: `${BANGLA_MONTHS[mIdx]} ${toBanglaDigits(yr)}` };
    }

    case 'LAST_30_DAYS': {
      const start = new Date(now);
      start.setDate(now.getDate() - 29);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      return { start, end, labelEn: 'Last 30 Days', labelBn: 'বিগত ৩০ দিন' };
    }

    case 'THIS_QUARTER': {
      const quarter = Math.floor(now.getMonth() / 3);
      const start = new Date(now.getFullYear(), quarter * 3, 1, 0, 0, 0, 0);
      const end = new Date(now.getFullYear(), (quarter + 1) * 3, 0, 23, 59, 59, 999);
      return { start, end, labelEn: `Q${quarter + 1} ${now.getFullYear()}`, labelBn: `ত্রৈমাসিক Q${toBanglaDigits(quarter + 1)} (${toBanglaDigits(now.getFullYear())})` };
    }

    case 'Q1': {
      const yr = config.selectedYear || currentYear;
      const start = new Date(yr, 0, 1, 0, 0, 0, 0);
      const end = new Date(yr, 3, 0, 23, 59, 59, 999);
      return { start, end, labelEn: `Q1 (Jan-Mar) ${yr}`, labelBn: `১ম ত্রৈমাসিক (জানু-মার্চ) ${toBanglaDigits(yr)}` };
    }

    case 'Q2': {
      const yr = config.selectedYear || currentYear;
      const start = new Date(yr, 3, 1, 0, 0, 0, 0);
      const end = new Date(yr, 6, 0, 23, 59, 59, 999);
      return { start, end, labelEn: `Q2 (Apr-Jun) ${yr}`, labelBn: `২য় ত্রৈমাসিক (এপ্রিল-জুন) ${toBanglaDigits(yr)}` };
    }

    case 'Q3': {
      const yr = config.selectedYear || currentYear;
      const start = new Date(yr, 6, 1, 0, 0, 0, 0);
      const end = new Date(yr, 9, 0, 23, 59, 59, 999);
      return { start, end, labelEn: `Q3 (Jul-Sep) ${yr}`, labelBn: `৩য় ত্রৈমাসিক (জুলাই-সেপ্টেম্বর) ${toBanglaDigits(yr)}` };
    }

    case 'Q4': {
      const yr = config.selectedYear || currentYear;
      const start = new Date(yr, 9, 1, 0, 0, 0, 0);
      const end = new Date(yr, 12, 0, 23, 59, 59, 999);
      return { start, end, labelEn: `Q4 (Oct-Dec) ${yr}`, labelBn: `৪র্থ ত্রৈমাসিক (অক্টোবর-ডিসেম্বর) ${toBanglaDigits(yr)}` };
    }

    case 'THIS_YEAR': {
      const start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
      const end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
      return { start, end, labelEn: `Year ${now.getFullYear()}`, labelBn: `চলতি বছর (${toBanglaDigits(now.getFullYear())})` };
    }

    case 'LAST_YEAR': {
      const lastYr = now.getFullYear() - 1;
      const start = new Date(lastYr, 0, 1, 0, 0, 0, 0);
      const end = new Date(lastYr, 11, 31, 23, 59, 59, 999);
      return { start, end, labelEn: `Year ${lastYr}`, labelBn: `বিগত বছর (${toBanglaDigits(lastYr)})` };
    }

    case 'SPECIFIC_YEAR': {
      const yr = config.selectedYear || currentYear;
      const start = new Date(yr, 0, 1, 0, 0, 0, 0);
      const end = new Date(yr, 11, 31, 23, 59, 59, 999);
      return { start, end, labelEn: `Year ${yr}`, labelBn: `সাল ${toBanglaDigits(yr)}` };
    }

    case 'SPECIFIC_MONTH': {
      const yr = config.selectedYear || currentYear;
      const month = config.selectedMonth !== undefined ? config.selectedMonth : now.getMonth();
      const start = new Date(yr, month, 1, 0, 0, 0, 0);
      const end = new Date(yr, month + 1, 0, 23, 59, 59, 999);
      return { 
        start, 
        end, 
        labelEn: `${ENGLISH_MONTHS[month]} ${yr}`, 
        labelBn: `${BANGLA_MONTHS[month]} ${toBanglaDigits(yr)}` 
      };
    }

    case 'SPECIFIC_WEEK': {
      const yr = config.selectedYear || currentYear;
      const week = config.selectedWeek || 1;
      // Get first day of that week
      const simple = new Date(yr, 0, 1 + (week - 1) * 7);
      const dow = simple.getDay();
      const start = new Date(simple);
      if (dow <= 4) {
        start.setDate(simple.getDate() - simple.getDay() + 1);
      } else {
        start.setDate(simple.getDate() + 8 - simple.getDay());
      }
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      return {
        start,
        end,
        labelEn: `Week ${week}, ${yr}`,
        labelBn: `সপ্তাহ ${toBanglaDigits(week)}, ${toBanglaDigits(yr)}`
      };
    }

    case 'CUSTOM_RANGE': {
      let start: Date | null = null;
      let end: Date | null = null;

      if (config.startDate) {
        start = new Date(`${config.startDate}T00:00:00`);
      }
      if (config.endDate) {
        end = new Date(`${config.endDate}T23:59:59.999`);
      }

      const labelEn = start && end 
        ? `${start.toLocaleDateString('en-GB')} to ${end.toLocaleDateString('en-GB')}`
        : start ? `From ${start.toLocaleDateString('en-GB')}` : 'Custom Range';

      const labelBn = start && end
        ? `${formatDateDisplay(start, true)} হতে ${formatDateDisplay(end, true)}`
        : 'কাস্টম তারিখ রেঞ্জ';

      return { start, end, labelEn, labelBn };
    }

    case 'ALL':
    default:
      return { start: null, end: null, labelEn: 'All Time Records', labelBn: 'সর্বকালীন রেকর্ড' };
  }
}

/**
 * Filter an array of items by a date field accessor using the DateFilterConfig
 */
export function filterItemsByDate<T>(
  items: T[],
  dateAccessor: (item: T) => string | Date | undefined | null,
  config: DateFilterConfig
): T[] {
  if (config.preset === 'ALL') return items;

  const { start, end } = getDateRangeBounds(config);
  if (!start && !end) return items;

  const startMs = start ? start.getTime() : -Infinity;
  const endMs = end ? end.getTime() : Infinity;

  return items.filter((item) => {
    const rawDate = dateAccessor(item);
    if (!rawDate) return false;
    const itemDate = typeof rawDate === 'string' ? new Date(rawDate) : rawDate;
    const itemMs = itemDate.getTime();
    if (isNaN(itemMs)) return false;
    return itemMs >= startMs && itemMs <= endMs;
  });
}

/**
 * Group items into daily, weekly, monthly, or yearly buckets for trend charts
 */
export function aggregateDataByTimeInterval<T>(
  items: T[],
  dateAccessor: (item: T) => string | Date | undefined | null,
  valueAccessor: (item: T) => number,
  interval: 'day' | 'week' | 'month' | 'year' = 'day'
): Array<{ period: string; count: number; totalValue: number; timestamp: number }> {
  const buckets: Record<string, { period: string; count: number; totalValue: number; timestamp: number }> = {};

  items.forEach((item) => {
    const rawDate = dateAccessor(item);
    if (!rawDate) return;
    const d = typeof rawDate === 'string' ? new Date(rawDate) : rawDate;
    if (isNaN(d.getTime())) return;

    let key = '';
    let periodLabel = '';

    if (interval === 'day') {
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      periodLabel = `${d.getDate()} ${ENGLISH_MONTHS[d.getMonth()].slice(0, 3)}`;
    } else if (interval === 'week') {
      const weekNum = Math.ceil((((d.getTime() - new Date(d.getFullYear(), 0, 1).getTime()) / 86400000) + new Date(d.getFullYear(), 0, 1).getDay() + 1) / 7);
      key = `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
      periodLabel = `Wk ${weekNum} (${ENGLISH_MONTHS[d.getMonth()].slice(0, 3)})`;
    } else if (interval === 'month') {
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      periodLabel = `${ENGLISH_MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
    } else {
      key = `${d.getFullYear()}`;
      periodLabel = `Year ${d.getFullYear()}`;
    }

    const val = valueAccessor(item) || 0;

    if (!buckets[key]) {
      buckets[key] = {
        period: periodLabel,
        count: 0,
        totalValue: 0,
        timestamp: d.getTime()
      };
    }

    buckets[key].count += 1;
    buckets[key].totalValue += val;
  });

  return Object.values(buckets).sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Export data array to a real Excel (.xlsx) workbook.
 *
 * The workbook is generated by `src/utils/spreadsheet.ts` instead of `xlsx`:
 * the npm build of that library is unfixed for its prototype-pollution and
 * formula-injection advisories, and it is not needed for writing three XML parts.
 * Text cells that Excel would evaluate (`=HYPERLINK(...)`, `=cmd|...`) are
 * neutralised on the way out, which matters because report rows contain free-text
 * customer input such as order notes and addresses.
 */
export function exportToExcel(
  data: Record<string, any>[],
  sheetName = 'KISHOLOY_Data',
  fileNamePrefix = 'Kisholoy_Report',
  filterConfig?: DateFilterConfig
): void {
  const bounds = filterConfig ? getDateRangeBounds(filterConfig) : null;
  const dateSuffix = new Date().toISOString().split('T')[0];
  const label = (bounds?.labelEn || 'Export').replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 60);
  const fullFileName = `${fileNamePrefix}_${label}_${dateSuffix}.xlsx`;

  const { bytes } = recordsToXlsx(data || [], { sheetName, fileName: fullFileName });
  downloadBytes(
    fullFileName,
    bytes,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
}

/**
 * Export data array to CSV with a UTF-8 BOM so Bangla survives a double-click
 * in Excel. Same formula-injection guard as the XLSX writer.
 */
export function exportToCsv(
  data: Record<string, any>[],
  fileNamePrefix = 'Kisholoy_Data',
  filterConfig?: DateFilterConfig
): void {
  if (!data || data.length === 0) return;

  const bounds = filterConfig ? getDateRangeBounds(filterConfig) : null;
  const dateSuffix = new Date().toISOString().split('T')[0];
  const label = (bounds?.labelEn || 'Export').replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 60);
  const fullFileName = `${fileNamePrefix}_${label}_${dateSuffix}.csv`;

  const { csv } = recordsToCsv(data, { fileName: fullFileName });
  downloadText(fullFileName, csv, 'text/csv;charset=utf-8;');
}

/**
 * Parse an uploaded workbook into JSON rows with date detection.
 *
 * Supports the OOXML zip format (`.xlsx`) and delimited text (`.csv`, `.tsv`,
 * `.txt`). Legacy `.xls` is BIFF8 — a binary format whose only safe parser was
 * the dependency we removed — so the operator gets a bilingual instruction to
 * re-save rather than a silent failure or a crash.
 */
export async function parseImportFile(file: File): Promise<{
  success: boolean;
  data: any[];
  headers: string[];
  totalRows: number;
  detectedDateColumns: string[];
  error?: string;
}> {
  const empty = {
    success: false as const,
    data: [] as any[],
    headers: [] as string[],
    totalRows: 0,
    detectedDateColumns: [] as string[]
  };
  const fail = (error: string) => ({ ...empty, error });

  const name = (file?.name || '').toLowerCase();

  try {
    let grid: any[][] = [];

    if (name.endsWith('.xlsx')) {
      const sheets = readXlsx(new Uint8Array(await file.arrayBuffer()));
      grid = sheets[0]?.rows || [];
    } else if (name.endsWith('.xls')) {
      return fail(
        'Legacy .xls files are not supported. Please re-save the sheet as .xlsx or .csv and upload again. ' +
          '(সহযোগিতা: ফাইলটি .xlsx বা .csv হিসেবে সেভ করে আবার আপলোড করুন।)'
      );
    } else if (name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.txt')) {
      grid = parseDelimited(await file.text());
    } else {
      return fail('Unsupported file type. Use .xlsx, .csv or .tsv. (শুধু .xlsx, .csv বা .tsv ফাইল আপলোড করুন।)');
    }

    const { records, headers } = rowsToRecords(grid);

    if (!records || records.length === 0) {
      return fail('The uploaded file contains no data rows.');
    }

    const detectedDateColumns: string[] = [];

    // Detect columns that represent dates
    headers.forEach((h) => {
      const sample = records[0]?.[h];
      if (
        typeof sample === 'string' &&
        (h.toLowerCase().includes('date') ||
         h.toLowerCase().includes('time') ||
         h.toLowerCase().includes('created') ||
         h.toLowerCase().includes('তারিখ') ||
         !isNaN(Date.parse(sample)))
      ) {
        detectedDateColumns.push(h);
      }
    });

    return {
      success: true,
      data: records,
      headers,
      totalRows: records.length,
      detectedDateColumns
    };
  } catch (err: any) {
    return fail(err?.message || 'Failed to parse file.');
  }
}
