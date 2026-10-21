import { getOpeningRecord, validAccountingDate, type OpeningBalances } from './index.ts';
import { money, type FinanceRecord, type TaxRecord } from './finance.ts';

export type TaxType = TaxRecord['taxType'];
export interface TaxLedgerEntry {
  id: string; type: string; date: string; ledgerStatus?: string;
  openingBalances?: OpeningBalances; confirmed?: boolean; reference?: string;
  finance?: FinanceRecord; outputVAT?: number; purchaseVAT?: number; withholdingTax?: number;
}
export interface TaxControl {
  taxType: TaxType; opening: number | null; additions: number; deductions: number;
  charges: number; credits: number; payments: number; closing: number | null;
  snapshotDate?: string;
}
export const TAX_LABELS: Record<TaxType, string> = { vat: 'VAT', wht: 'WHT', income_tax: 'Income tax' };
/** Suggestions only: the recipient must still confirm and supply receipt evidence. */
export function taxDraftFromParams(params: Record<string, string | undefined>, today: string) {
  const taxType: TaxType = params.taxType === 'wht' || params.taxType === 'income_tax' ? params.taxType : 'vat';
  const action: TaxRecord['action'] = params.action === 'charge' || params.action === 'credit' ? params.action : 'payment';
  const n = Number(params.amount);
  return { taxType, action,
    amount: params.amount && Number.isFinite(n) && n > 0 && n <= 1e12 ? String(money(n)) : '',
    date: validAccountingDate(params.date) && params.date! <= today ? params.date! : today,
    confirmed: false, source: '', reference: '' };
}
export function buildTaxControlLedger(entries: TaxLedgerEntry[], start: string, end: string): TaxControl[] {
  if (!validAccountingDate(start) || !validAccountingDate(end) || start > end) throw new Error('Choose a valid tax period.');
  const active = entries.filter(e => e.ledgerStatus !== 'void');
  const snapshot = getOpeningRecord(active, end);
  // A snapshot closes its date. Earlier activity is not counted twice.
  const anchor = snapshot?.date;
  const activity = active.filter(e => (!anchor || e.date > anchor) && e.date <= end);
  const amount = (n = 0) => {
    if (!Number.isFinite(n) || n < 0) throw new Error('Review invalid tax amounts in the source records.');
    return n;
  };
  return (['vat', 'wht', 'income_tax'] as TaxType[]).map(taxType => {
    const base = snapshot?.openingBalances;
    const initial = base ? taxType === 'vat' ? base.vatLiability : taxType === 'wht' ? base.whtLiability : base.incomeTaxLiability : 0;
    let before = initial, additions = 0, deductions = 0, charges = 0, credits = 0, payments = 0;
    for (const entry of activity) {
      let add = 0, deduct = 0, charge = 0, credit = 0, payment = 0;
      if (taxType === 'vat') {
        if (['sale', 'credit_sale'].includes(entry.type)) add = amount(entry.outputVAT);
        if (entry.type === 'return_inward') deduct = amount(entry.outputVAT);
        if (['purchase', 'credit_purchase'].includes(entry.type)) deduct = amount(entry.purchaseVAT);
      }
      if (taxType === 'wht' && ['purchase', 'credit_purchase'].includes(entry.type)) add = amount(entry.withholdingTax);
      const r = entry.finance;
      if (r?.kind === 'tax' && r.taxType === taxType && r.confirmed === true) {
        if (r.action === 'charge') charge = amount(r.amount);
        if (r.action === 'credit') credit = amount(r.amount);
        if (r.action === 'payment') payment = amount(r.amount);
      }
      if (entry.date < start) before += add - deduct + charge - credit - payment;
      else { additions += add; deductions += deduct; charges += charge; credits += credit; payments += payment; }
    }
    return { taxType, opening: snapshot ? money(before) : null, snapshotDate: snapshot && snapshot.date >= start ? snapshot.date : undefined,
      additions: money(additions), deductions: money(deductions), charges: money(charges), credits: money(credits),
      payments: money(payments), closing: snapshot ? money(before + additions - deductions + charges - credits - payments) : null };
  });
}
export function taxControlRows(control: TaxControl, end: string) {
  return [
    { label: control.snapshotDate ? `Confirmed opening as at ${control.snapshotDate}` : 'Opening tax balance', value: control.opening },
    ...(control.taxType === 'income_tax' ? [] : [{ label: control.taxType === 'vat' ? 'Sales VAT' : 'Supplier WHT', value: control.additions }]),
    ...(control.taxType === 'vat' ? [{ label: 'Less input VAT and customer-return VAT', value: -control.deductions }] : []),
    { label: 'Confirmed assessments / adjustments', value: control.charges },
    { label: 'Less confirmed credits', value: -control.credits },
    { label: 'Less tax payments', value: -control.payments },
    { label: `Tax control balance as at ${end}`, value: control.closing },
  ];
}
