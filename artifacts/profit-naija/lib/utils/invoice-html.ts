import type { Entry } from '@/context/EntriesContext';
import type { UserProfile } from '@/context/ProfileContext';
import { getEntryVAT, getGrossSaleValue, getSaleValue } from './formulas.ts';

const NAIRA = '₦';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[character] ?? character));
}

function money(value: number): string {
  return `${NAIRA}${Math.abs(value).toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function dateLabel(value: string): string {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** A deterministic, human-readable invoice reference for an immutable entry. */
export function getInvoiceNumber(entry: Pick<Entry, 'id' | 'date'>): string {
  const idPart = entry.id.replace(/[^a-zA-Z0-9]/g, '').slice(-8).toUpperCase() || 'SALE';
  return `PN-${entry.date.replace(/[^0-9]/g, '').slice(0, 8) || '00000000'}-${idPart}`;
}

/** Customer-facing invoice amount, including VAT in the selling price. */
export function getInvoiceGross(entry: Entry): number {
  return Math.max(0, getGrossSaleValue(entry));
}

export function buildInvoiceHtml(entry: Entry, profile: UserProfile, paidToDate = 0, returnCredits = 0): string {
  const quantity = typeof entry.unitsSold === 'number' ? entry.unitsSold : 1;
  const unitPrice = typeof entry.unitSalesPrice === 'number'
    ? entry.unitSalesPrice
    : entry.amount;
  const gross = getInvoiceGross(entry);
  const base = getSaleValue(entry);
  const vat = getEntryVAT(entry);
  const paid = Math.min(Math.max(0, paidToDate), gross);
  const balance = Math.max(0, gross - paid - returnCredits);
  const isCredit = entry.type === 'credit_sale';
  const paymentStatus = !isCredit || paid + returnCredits >= gross
    ? 'Paid'
    : paid > 0
      ? 'Partially paid'
      : 'Payment pending';
  const invoiceNumber = getInvoiceNumber(entry);
  const item = entry.itemName || entry.category || 'Sale';
  const customer = entry.partyName || 'Walk-in customer';
  const phone = entry.partyPhone ? `<div class="muted">${escapeHtml(entry.partyPhone)}</div>` : '';

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(invoiceNumber)} — ${escapeHtml(profile.businessName || 'ProfitNaija')}</title>
<style>
  *{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#172033;padding:32px;max-width:760px;margin:0 auto;overflow-wrap:anywhere}
  .top{display:flex;justify-content:space-between;align-items:flex-start;gap:28px;border-bottom:3px solid #16723a;padding-bottom:22px}
  .seller{min-width:0;flex:1}.seller h1{font-size:26px;color:#16723a;line-height:1.15;margin:0 0 8px;overflow-wrap:anywhere}
  .muted{color:#64748b;font-size:13px;line-height:1.5;overflow-wrap:anywhere}
  .label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#64748b;margin-bottom:4px}
  .meta{text-align:right;flex:0 1 230px;min-width:0}.meta strong{display:block;font-size:16px;margin-bottom:7px;overflow-wrap:anywhere}
  .customer{margin:26px 0 22px;padding:14px 16px;border:1px solid #e5e7eb;border-radius:8px}.customer strong{font-size:16px;overflow-wrap:anywhere}
  table{width:100%;border-collapse:collapse;margin-top:20px;table-layout:fixed}th,td{text-align:left;padding:12px 8px;border-bottom:1px solid #e5e7eb;overflow-wrap:anywhere}th{font-size:11px;text-transform:uppercase;color:#64748b}
  th:nth-child(2),td:nth-child(2){width:14%;text-align:center}th:nth-child(3),td:nth-child(3){width:30%;text-align:right}
  .summary{margin:20px 0 0 auto;max-width:340px}.sum{display:flex;justify-content:space-between;gap:24px;padding:8px 0}.sum span{min-width:0}.sum strong{white-space:nowrap}.total{border-top:2px solid #172033;margin-top:6px;padding-top:13px;font-size:18px;font-weight:bold}
  .balance-value{color:#c62828}.status{display:inline-block;margin-top:22px;padding:8px 13px;border-radius:999px;background:#e8f5e9;color:#16723a;font-weight:bold;font-size:12px}
  footer{margin-top:44px;text-align:center;color:#64748b;font-size:12px}
  @media (max-width:560px){body{padding:20px}.top{flex-direction:column;gap:16px}.meta{text-align:left;flex-basis:auto;width:100%}.customer{margin-top:20px}table{font-size:12px}th,td{padding:9px 4px}.summary{max-width:none}.sum{gap:12px}}
  @media print{body{padding:0}.no-print{display:none}}
  @media print and (max-width:560px){.top{flex-direction:column;gap:16px}.meta{text-align:left;width:100%}}
</style></head><body>
  <div class="top"><div class="seller"><h1>${escapeHtml(profile.businessName || 'ProfitNaija Business')}</h1>
    ${(profile.businessAddress || profile.homeAddress) ? `<div class="muted">${escapeHtml(profile.businessAddress || profile.homeAddress)}</div>` : ''}
    ${(profile.businessPhone || profile.phone) ? `<div class="muted">${escapeHtml(profile.businessPhone || profile.phone)}</div>` : ''}
    ${profile.email ? `<div class="muted">${escapeHtml(profile.email)}</div>` : ''}
  </div><div class="meta"><div class="label">Invoice</div><strong>${escapeHtml(invoiceNumber)}</strong>
    <div class="muted">Date: ${escapeHtml(dateLabel(entry.date))}</div>
  </div></div>
  <div class="customer"><div class="label">Bill to</div><strong>${escapeHtml(customer)}</strong>${phone}</div>
  <table><thead><tr><th>Item</th><th>Qty</th><th>Unit selling price</th><th>Amount (excl. VAT)</th></tr></thead>
    <tbody><tr><td>${escapeHtml(item)}</td><td>${quantity}</td><td>${money(unitPrice)}</td><td>${money(base)}</td></tr></tbody>
  </table>
  <div class="summary"><div class="sum"><span>Sales amount (excl. VAT)</span><strong>${money(base)}</strong></div><div class="sum"><span>VAT (7.5%)</span><strong>${money(vat)}</strong></div><div class="sum total"><span>Invoice Total</span><strong>${money(gross)}</strong></div>
    ${isCredit ? `<div class="sum"><span>Paid</span><strong>${money(paid)}</strong></div>${returnCredits ? `<div class="sum"><span>Reviewed return credits</span><strong>${money(returnCredits)}</strong></div>` : ''}<div class="sum"><span>Balance Due</span><strong class="balance-value">${money(balance)}</strong></div>` : ''}
  </div>
  <div class="status">${isCredit ? `Debtors · ${paymentStatus}` : `${entry.paymentMode === 'bank' ? 'Bank' : 'Cash'} Sale · Paid`}</div>
  ${entry.notes ? `<p class="muted" style="margin-top:20px"><strong>Note:</strong> ${escapeHtml(entry.notes)}</p>` : ''}
  <footer>Generated with ProfitNaija</footer>
</body></html>`;
}