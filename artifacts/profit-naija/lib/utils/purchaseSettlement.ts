import type { Entry, Product } from '@/context/EntriesContext';
import { getOutstandingCredits, getPurchaseBaseCost, getInventoryMovementCost, getReturnBaseCost, supplierPurchasePayable } from './formulas.ts';

export interface PurchaseSettlement {
  base: number; materials: number; carriage: number; handling: number;
  landed: number; vat: number; withholding: number;
  payable: number; paid: number; outstanding: number; returnCredits: number; isCredit: boolean;
}

/** Presentation-only summary. Credit balances come from getOutstandingCredits; no records are rewritten. */
export function getPurchaseSettlement(entry: Entry, allEntries: Entry[], asOf?: string): PurchaseSettlement {
  const base = getPurchaseBaseCost(entry);
  const materials = entry.materialCosts?.reduce((s, c) => s + c, 0) ?? 0;
  const carriage = entry.carriageInward ?? 0;
  const handling = entry.handlingCost ?? 0;
  const vat = entry.purchaseVAT ?? 0;
  const withholding = entry.withholdingTax ?? 0;
  const landed = base + materials + carriage + handling;
  const isCredit = entry.type === 'credit_purchase';
  if (!isCredit) {
    const payable = supplierPurchasePayable(entry);
    return { base, materials, carriage, handling, landed, vat, withholding, payable, paid: payable, outstanding: 0, returnCredits: 0, isCredit };
  }
  const credit = getOutstandingCredits(asOf ? allEntries.filter(e => e.date <= asOf) : allEntries, 'purchase', undefined, true).find(c => c.originalEntry.id === entry.id);
  const payable = credit?.grossAmount ?? supplierPurchasePayable(entry);
  const paid = credit?.paidToDate ?? 0;
  return { base, materials, carriage, handling, landed, vat, withholding, payable, paid, returnCredits: credit?.returnCredits ?? 0, outstanding: credit?.remainingBalance ?? Math.max(0, payable - paid), isCredit };
}

export function sumPurchaseSettlements(list: PurchaseSettlement[]): PurchaseSettlement {
  const z: PurchaseSettlement = { base: 0, materials: 0, carriage: 0, handling: 0, landed: 0, vat: 0, withholding: 0, payable: 0, paid: 0, outstanding: 0, returnCredits: 0, isCredit: false };
  for (const s of list) for (const k of Object.keys(z) as Array<keyof PurchaseSettlement>) if (k !== 'isCredit') (z[k] as number) += s[k] as number;
  return z;
}

/** Cost-only totals. The bill difference is diagnostic, not a cost or expense row. */
export function getPurchaseCostReconciliation(s: PurchaseSettlement, returnedCost: number) {
  const difference = s.landed - (s.payable - s.vat + s.withholding);
  const rows = [
    { label: 'Landed purchases before returns', value: s.landed },
    { label: 'Less returned inventory (at landed cost)', value: -returnedCost },
    { label: 'My Purchases (net landed cost)', value: s.landed - returnedCost },
  ];
  return { difference, netPurchases: s.landed - returnedCost, rows };
}

export type PurchaseDetailRow = { label: string; value: number | null; quantity?: boolean; total?: boolean };

/** One presentation model for the screen and all exports. */
export function getPurchaseDetailSections(s: PurchaseSettlement, purchases: Entry[], returns: Entry[], products: Product[]) {
  const units = purchases.reduce((sum, entry) => sum + (entry.unitsPurchased ?? 0), 0);
  const returnedBase = returns.reduce((sum, entry) => sum + getReturnBaseCost(entry,
    products.find(product => product.id === entry.productId)?.costPrice ?? 0) * (entry.unitsSold ?? 0), 0);
  const returnedLanded = returns.reduce((sum, entry) => sum + getInventoryMovementCost(entry, products), 0);
  const perUnit = (value: number) => units > 0 ? value / units : null;
  const costRows: PurchaseDetailRow[] = [
    { label: 'Units purchased', value: units, quantity: true },
    { label: 'Unit base cost (weighted average)', value: perUnit(s.base) },
    { label: 'Total base cost', value: s.base },
    { label: 'Less Returns Outward (base cost)', value: -returnedBase },
    { label: 'Net base cost', value: s.base - returnedBase, total: true },
    { label: 'Carriage cost per unit', value: perUnit(s.carriage) },
    { label: 'Total carriage cost', value: s.carriage },
    { label: 'Handling cost per unit', value: perUnit(s.handling) },
    { label: 'Total handling cost', value: s.handling },
    ...(s.materials ? [{ label: 'Material / direct costs', value: s.materials }] : []),
    ...(Math.abs(returnedLanded - returnedBase) >= 0.005
      ? [{ label: returnedLanded >= returnedBase ? 'Less returned ancillary costs' : 'Returned cost adjustment — review',
        value: -(returnedLanded - returnedBase) }] : []),
    { label: 'Total landed cost (My Purchases)', value: s.landed - returnedLanded, total: true },
  ];
  const supplierRows: PurchaseDetailRow[] = [
    { label: 'Recorded supplier bills (before returns / refunds)', value: s.payable },
    { label: 'Recoverable input VAT', value: s.vat },
    { label: 'Less withholding deduction', value: -s.withholding },
    { label: 'Paid to date', value: s.paid },
    ...(s.returnCredits ? [{ label: 'Less reviewed supplier return credits', value: -s.returnCredits }] : []),
    { label: 'OUTSTANDING SUPPLIER BALANCE', value: s.outstanding, total: true },
  ];
  // The final landed total is shown once, in the cost section above.
  const reconciliationRows: PurchaseDetailRow[] = getPurchaseCostReconciliation(s, returnedLanded).rows.slice(0, -1);
  return { costRows, supplierRows, reconciliationRows };
}
