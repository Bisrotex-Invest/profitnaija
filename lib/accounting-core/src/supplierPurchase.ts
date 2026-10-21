/** Purchase charges owed to the supplier; paid amounts are never changed here. */
export interface SupplierPurchaseFields {
  amount?: number;
  unitPurchasePrice?: number;
  baseCost?: number;
  unitsPurchased?: number;
  purchaseAmount?: number;
  totalLandedCost?: number;
  materialCosts?: number[];
  carriageInward?: number;
  handlingCost?: number;
  purchaseVAT?: number;
  withholdingTax?: number;
  supplierPayable?: number;
}

export function supplierPurchasePayable(entry: SupplierPurchaseFields): number {
  const materials = entry.materialCosts?.reduce((sum, value) => sum + value, 0) ?? 0;
  let landed: number;
  if (typeof entry.unitsPurchased === 'number' &&
      (typeof entry.unitPurchasePrice === 'number' || typeof entry.baseCost === 'number')) {
    landed = entry.unitsPurchased * (entry.unitPurchasePrice ?? entry.baseCost ?? 0)
      + materials + (entry.carriageInward ?? 0) + (entry.handlingCost ?? 0);
  } else if (typeof entry.purchaseAmount === 'number') {
    landed = entry.purchaseAmount + (entry.carriageInward ?? 0) + (entry.handlingCost ?? 0);
  } else if (typeof entry.totalLandedCost === 'number') {
    landed = entry.totalLandedCost;
  } else if (typeof entry.supplierPayable === 'number') {
    // Without a reconstructible cost basis, do not add tax or charges twice.
    return Math.max(0, entry.supplierPayable);
  } else {
    landed = (entry.amount ?? 0) + (entry.carriageInward ?? 0) + (entry.handlingCost ?? 0);
  }
  return Math.max(0, landed + (entry.purchaseVAT ?? 0) - (entry.withholdingTax ?? 0));
}
