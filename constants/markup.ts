export const INDUSTRIES = [
  'Food & Groceries',
  'Fashion & Clothing',
  'Electronics & Phones',
  'Cosmetics & Beauty',
  'Pharmacy',
  'General Goods',
] as const;

export type Industry = (typeof INDUSTRIES)[number];

export const INDUSTRY_MARKUP: Record<Industry, number> = {
  'Food & Groceries': 15,
  'Fashion & Clothing': 50,
  'Electronics & Phones': 20,
  'Cosmetics & Beauty': 40,
  'Pharmacy': 25,
  'General Goods': 30,
};

export function suggestedPrice(costPrice: number, markupPct: number): number {
  return costPrice * (1 + markupPct / 100);
}
