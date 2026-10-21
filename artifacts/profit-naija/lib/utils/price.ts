/**
 * ProfitNaija — VAT & pricing utilities
 * Nigerian VAT rate: 7.5% (Finance Act 2019)
 */

export const VAT_RATE = 0.075;

/**
 * Returns a VAT-exclusive selling price: cost × (1 + markup/100).
 */
export function calculateSuggestedPrice(costPrice: number, markupPercent: number): number {
  const preVat = costPrice * (1 + markupPercent / 100);
  return preVat;
}

/** Remove the former VAT uplift from unmarked stored suggestions, once. */
export function getVATExclusiveSuggestedPrice(product: { suggestedPrice?: number; costPrice?: number; unitPurchasePrice?: number; baseCost?: number; markup?: number; vatExclusive?: boolean; purchaseVatCharged?: boolean }): number {
  const price = product.suggestedPrice ?? 0;
  const base = calculateSuggestedPrice(product.costPrice ?? product.unitPurchasePrice ?? product.baseCost ?? 0, product.markup ?? 0);
  if (product.vatExclusive || typeof product.purchaseVatCharged === 'boolean' || Math.abs(price - base) < 0.01) return price;
  return Math.round(price / (1 + VAT_RATE) * 100) / 100;
}

/**
 * Entered selling prices already exclude VAT.
 */
export function extractPreVat(enteredPrice: number): number {
  return enteredPrice;
}

/**
 * Returns VAT calculated directly on the entered customer price.
 */
export function extractVATAmount(enteredPrice: number): number {
  return enteredPrice * VAT_RATE;
}

/**
 * Formats a VAT-exclusive price.
 */
export function formatVATPrice(price: number): string {
  return `₦${price.toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} excl. VAT`;
}

/**
 * Returns true if the entered base price is below the suggested base price.
 */
export function isBelowVATSuggestedPrice(
  enteredPrice: number,
  costPrice: number,
  markupPercent: number,
): boolean {
  return enteredPrice < calculateSuggestedPrice(costPrice, markupPercent);
}
