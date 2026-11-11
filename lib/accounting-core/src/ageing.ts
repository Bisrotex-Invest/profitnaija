const DAY_MS = 24 * 60 * 60 * 1000;

function utcDayNumber(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) return null;
  return Math.floor(timestamp / DAY_MS);
}

/** Calendar days a credit has been open as of the selected report cutoff. */
export function getAgeingDays(creditDate: string, asOfDate: string): number | null {
  const creditDay = utcDayNumber(creditDate);
  const asOfDay = utcDayNumber(asOfDate);
  if (creditDay === null || asOfDay === null) return null;
  return Math.max(0, asOfDay - creditDay);
}
