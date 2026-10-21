/** Reviewed return credits are not cash refunds. Unmarked legacy returns keep their treatment. */
export interface ReturnCreditEntry {
  id?: string; type: string; date?: string; amount: number; ledgerStatus?: string;
  returnCreditEntryId?: string; returnCreditKind?: 'sale' | 'purchase';
  paymentMode?: string; unitsSold?: number; unitSalesPrice?: number;
  vatPaid?: number; returnVat?: number; vatExclusive?: boolean;
}
export function isCreditReturn(entry: Pick<ReturnCreditEntry, 'type' | 'returnCreditEntryId'>): boolean {
  return ['return_inward', 'return_outward'].includes(entry.type) && !!entry.returnCreditEntryId;
}
export function returnCreditAmount(entry: ReturnCreditEntry): number {
  if (entry.type === 'return_outward') return entry.amount;
  if (typeof entry.unitsSold === 'number' && typeof entry.unitSalesPrice === 'number') {
    const base = Math.round(entry.unitsSold * entry.unitSalesPrice * 100) / 100;
    const vat = Math.round(Math.max(0, entry.unitsSold * entry.unitSalesPrice * .075) * 100) / 100;
    return Math.round((base + vat) * 100) / 100;
  }
  const vat = Math.round(Math.max(0, entry.returnVat ?? entry.vatPaid ?? 0) * 100) / 100;
  return Math.round((entry.vatExclusive === true ? Math.max(entry.amount, vat) : entry.amount + vat) * 100) / 100;
}
export function creditReturnTotal(entries: ReturnCreditEntry[], originalId: string, kind: string): number {
  if (kind === 'expense') return 0;
  const total = entries.filter(e => e.ledgerStatus !== 'void' && isCreditReturn(e)
    && e.returnCreditEntryId === originalId
    && e.type === (kind === 'sale' ? 'return_inward' : 'return_outward'))
    .reduce((sum, e) => sum + returnCreditAmount(e), 0);
  return Math.round(total * 100) / 100;
}
