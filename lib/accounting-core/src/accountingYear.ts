/** Financial reporting periods only. Never changes statutory tax-year rules. */
export const DEFAULT_ACCOUNTING_YEAR_END = '12-31';
export const ACCOUNTING_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

export function accountingMonthDays(month: number): number {
  return new Date(Date.UTC(2024, month, 0)).getUTCDate();
}

export function validAccountingYearEnd(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{2}-\d{2}$/.test(value)) return false;
  const [month, day] = value.split('-').map(Number);
  return month >= 1 && month <= 12 && day >= 1 && day <= accountingMonthDays(month);
}

export function normalizeAccountingYearEnd(value: unknown): string {
  return validAccountingYearEnd(value) ? value : DEFAULT_ACCOUNTING_YEAR_END;
}

export function accountingYearEndForMonth(value: string, month: number): string {
  const day = Math.min(Number(normalizeAccountingYearEnd(value).slice(3)), accountingMonthDays(month));
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function yearEndDate(year: number, value: string): string {
  const [month, day] = normalizeAccountingYearEnd(value).split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

function nextDay(value: string, offset: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function getAccountingYearRange(asOf: string, yearEnd = DEFAULT_ACCOUNTING_YEAR_END): { start: string; end: string } {
  const parsed = new Date(`${asOf}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== asOf) {
    throw new Error('Enter a valid accounting-period date.');
  }
  const year = Number(asOf.slice(0, 4));
  const closingYear = asOf <= yearEndDate(year, yearEnd) ? year : year + 1;
  return { start: nextDay(yearEndDate(closingYear - 1, yearEnd), 1), end: yearEndDate(closingYear, yearEnd) };
}

export function getAccountingYearToDate(asOf: string, yearEnd = DEFAULT_ACCOUNTING_YEAR_END): { start: string; end: string } {
  return { start: getAccountingYearRange(asOf, yearEnd).start, end: asOf };
}

export function getPreviousAccountingYear(asOf: string, yearEnd = DEFAULT_ACCOUNTING_YEAR_END): { start: string; end: string } {
  return getAccountingYearRange(nextDay(getAccountingYearRange(asOf, yearEnd).start, -1), yearEnd);
}

export function formatAccountingDate(value: string): string {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString('en-NG', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

export function profitStatementYearLabel(asOf: string, yearEnd = DEFAULT_ACCOUNTING_YEAR_END): string {
  return `the year ended ${formatAccountingDate(getAccountingYearRange(asOf, yearEnd).end)}`;
}
