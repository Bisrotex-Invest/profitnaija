import type { PositionRow } from './index.ts';

/** Workbook sections, without inventing unsupported balances or reclassifying opening aggregates. */
export function balanceSheetLayout(rows: PositionRow[]): PositionRow[] {
  const find = (key: string) => rows.find(r => r.key === key);
  const present = (keys: string[]) => keys.flatMap(k => find(k) ? [find(k)!] : []);
  const sum = (keys: string[]): number | null => {
    const values = keys.filter(k=>find(k)).map(k => find(k)?.value);
    return values.every((v): v is number => typeof v === 'number')
      ? Math.round(values.reduce((s, v) => s + v, 0) * 100) / 100 : null;
  };
  const currentAssets = ['cash', 'bank', 'debtors', 'inventory', 'prepayments', 'other-current-assets'];
  const nonCurrentAssets = ['property-plant-equipment', 'other-non-current-assets'];
  const currentLiabilities = ['creditors', 'accrued-expenses', 'unearned-revenue', 'current-loans', 'vat', 'withholding-tax', 'income-tax', 'other-current-liabilities'];
  const tail = rows.slice(rows.findIndex(r => r.key === 'equity'));
  return [
    ...present(['assets']),
    { key: 'current-assets', label: 'Current assets', value: null, section: true },
    ...present(currentAssets),
    { key: 'total-current-assets', label: 'Total current assets', value: sum(currentAssets), total: true },
    { key: 'non-current-assets', label: 'Non-current assets', value: null, section: true },
    ...present(nonCurrentAssets),
    { key: 'total-non-current-assets', label: 'Total non-current assets', value: sum(nonCurrentAssets), total: true },
    ...present(['recorded-assets', 'liabilities']),
    { key: 'current-liabilities', label: 'Current liabilities', value: null, section: true },
    ...present(currentLiabilities),
    { key: 'total-current-liabilities', label: 'Total current liabilities', value: sum(currentLiabilities), total: true },
    { key: 'non-current-liabilities', label: 'Non-current liabilities', value: null, section: true },
    ...present(['loans']),
    { key: 'total-non-current-liabilities', label: 'Total classified non-current liabilities', value: sum(['loans']), total: true },
    ...present(['unclassified-loans']),
    ...present(['total-creditors', 'recorded-liabilities', 'net-recorded-assets']),
    ...tail,
  ];
}
