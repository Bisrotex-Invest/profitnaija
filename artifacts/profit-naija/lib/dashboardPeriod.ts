import { getAccountingYearToDate } from '@workspace/accounting-core';
export type DashboardPeriod = 'daily' | 'weekly' | 'monthly' | 'last_month' | 'yearly' | 'all' | 'custom';
export type DashboardPeriodSelection = { period: DashboardPeriod; customStart: string; customEnd: string };
export type DashboardDateRange = { start: string; end: string; label: string };

export const DASHBOARD_PERIOD_OPTIONS: { value: DashboardPeriod; label: string }[] = [
  { value: 'daily', label: 'Today' },
  { value: 'weekly', label: 'This week' },
  { value: 'monthly', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'yearly', label: 'Accounting year to date' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom range' },
];

export function dashboardDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function defaultDashboardSelection(now = new Date()): DashboardPeriodSelection {
  return { period: 'monthly', customStart: dashboardDate(new Date(now.getFullYear(), now.getMonth(), 1)), customEnd: dashboardDate(now) };
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00`);
  return !Number.isNaN(parsed.getTime()) && dashboardDate(parsed) === value;
}

export function dashboardRangeError(start: string, end: string, today = dashboardDate()): string | undefined {
  if (!validDate(start) || !validDate(end)) return 'Enter valid start and end dates.';
  if (start > end) return 'The start date must be on or before the end date.';
  if (end > today) return 'Select an end date on or before today.';
  return undefined;
}

export function resolveDashboardRange(
  selection: DashboardPeriodSelection,
  entries: readonly { date: string }[],
  now = new Date(),
  accountingYearEnd = '12-31',
): DashboardDateRange {
  const end = dashboardDate(now);
  let start = end;
  let rangeEnd = end;
  switch (selection.period) {
    case 'weekly': {
      const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
      start = dashboardDate(monday);
      break;
    }
    case 'monthly':
      start = dashboardDate(new Date(now.getFullYear(), now.getMonth(), 1));
      break;
    case 'last_month':
      start = dashboardDate(new Date(now.getFullYear(), now.getMonth() - 1, 1));
      rangeEnd = dashboardDate(new Date(now.getFullYear(), now.getMonth(), 0));
      break;
    case 'yearly':
      start = getAccountingYearToDate(end, accountingYearEnd).start;
      break;
    case 'all':
      start = entries.reduce((earliest, entry) => validDate(entry.date) && entry.date < earliest ? entry.date : earliest, end);
      break;
    case 'custom': {
      const error = dashboardRangeError(selection.customStart, selection.customEnd, end);
      if (error) throw new Error(error);
      start = selection.customStart;
      rangeEnd = selection.customEnd;
      break;
    }
  }
  const format = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
  return { start, end: rangeEnd, label: start === rangeEnd ? format(start) : `${format(start)} – ${format(rangeEnd)}` };
}

export function dashboardPeriodEntries<T extends { date: string }>(entries: readonly T[], range: DashboardDateRange): T[] {
  return entries.filter(entry => entry.date >= range.start && entry.date <= range.end);
}

export function dashboardBalanceEntries<T extends { date: string }>(entries: readonly T[], range: DashboardDateRange): T[] {
  return entries.filter(entry => entry.date <= range.end);
}