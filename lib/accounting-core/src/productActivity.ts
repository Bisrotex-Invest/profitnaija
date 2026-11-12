import type { SupplierPurchaseFields } from './supplierPurchase.ts';

export interface ProductActivityEntry extends SupplierPurchaseFields {
  type: string;
  productId?: string;
  ledgerStatus?: string;
  unitsSold?: number;
  unitSalesPrice?: number;
  vatPaid?: number;
  vatExclusive?: boolean;
}

/** Lifetime purchase/sale activity, not closing-stock valuation. Returns and
 * adjustments remain reflected in the authoritative product stock balance. */
export function productActivity(
  product: { id: string; stockQty: number; suggestedPrice: number },
  entries: ProductActivityEntry[],
) {
  const purchases = entries.filter(e => e.productId === product.id && e.ledgerStatus !== 'void'
    && (e.type === 'purchase' || e.type === 'credit_purchase'));
  const sales = entries.filter(e => e.productId === product.id && e.ledgerStatus !== 'void'
    && (e.type === 'sale' || e.type === 'credit_sale'));
  const unitsPurchased = purchases.reduce((sum, e) => sum + (e.unitsPurchased ?? 0), 0);
  const totalPurchasePrice = purchases.reduce((sum, e) => {
    const materials = e.materialCosts?.reduce((total, value) => total + value, 0) ?? 0;
    const base = (e.unitPurchasePrice ?? e.baseCost) != null && e.unitsPurchased != null
      ? e.unitsPurchased * (e.unitPurchasePrice ?? e.baseCost ?? 0)
      : e.purchaseAmount != null ? e.purchaseAmount - materials
        : e.totalLandedCost != null ? e.totalLandedCost - materials
          - (e.carriageInward ?? 0) - (e.carriageCost ?? 0) - (e.handlingCost ?? 0)
          : (e.amount ?? 0) - materials;
    return sum + Math.max(0, base);
  }, 0);
  const unitsSold = sales.reduce((sum, e) => sum + (e.unitsSold ?? 0), 0);
  const baseSales = sales.reduce((sum, e) => sum
    + (e.unitSalesPrice != null && e.unitsSold != null
      ? e.unitSalesPrice * e.unitsSold
      : Math.max(0, (e.amount ?? 0) - (e.vatExclusive ? e.vatPaid ?? 0 : 0))), 0);
  return {
    unitsPurchased,
    unitPurchasePrice: unitsPurchased > 0 ? totalPurchasePrice / unitsPurchased : null,
    totalPurchasePrice,
    unitsSold,
    unitSellingPrice: unitsSold > 0 ? baseSales / unitsSold : product.suggestedPrice,
    unitsRemaining: product.stockQty,
  };
}

export function productActivityRows(
  product: Parameters<typeof productActivity>[0],
  entries: ProductActivityEntry[],
) {
  const s = productActivity(product, entries);
  return [
    { label: 'Units purchased', value: s.unitsPurchased, quantity: true },
    { label: 'Unit purchase price (weighted average)', value: s.unitPurchasePrice },
    { label: 'Total purchase price (goods only)', value: s.totalPurchasePrice },
    { label: 'Units sold', value: s.unitsSold, quantity: true },
    { label: s.unitsSold > 0 ? 'Unit selling price (weighted average)' : 'Unit selling price (current)', value: s.unitSellingPrice },
    { label: 'Units remaining (balance)', value: s.unitsRemaining, quantity: true },
  ];
}
