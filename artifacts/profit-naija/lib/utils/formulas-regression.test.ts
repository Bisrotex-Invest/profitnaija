import assert from 'node:assert/strict';
import test from 'node:test';
import type { Entry, Product } from '@/context/EntriesContext';
import { buildDirectCashFlow, buildPnLReport, buildVATLedger, calcCashSales, calcCostBalance, calcDashboardRevenue, calcDirectExpensesForEntries, calcInventoryValueAsOf, calcNetRevenue, calcSalesExcludingVAT, calcSalesVATPassThrough, calcStockValue, calcTotalSales, getEntryVAT, getOutstandingCredits, getSaleValue, getStockValueBreakdown, getSupplierReturnExpense } from '@/lib/utils/formulas';

test('Sales card excludes VAT from four customer totals without changing gross Revenue', () => {
  const amounts = [49_450, 42_900, 125_000, 247_250];
  const entries = amounts.map((amount, index) => ({
    id: `sale-${index}`, type: index < 2 ? 'credit_sale' : 'sale',
    date: '2026-09-17', createdAt: index, amount,
    unitsSold: 1, unitSalesPrice: amount, vatPaid: amount * 0.075,
  })) as any;
  assert.equal(calcTotalSales(entries), 499_445);
  assert.equal(calcSalesExcludingVAT(entries), 464_600);
  assert.deepEqual(entries.map((entry: any) => getSaleValue(entry)), amounts);
  assert.equal(calcNetRevenue(entries), 499_445);
});

test('Revenue card excludes VAT from both sales and returns', () => {
  const amounts = [49_450, 42_900, 125_000, 247_250];
  const entries = [
    ...amounts.map((amount, index) => ({
      id: `sale-${index}`, type: index < 2 ? 'credit_sale' : 'sale',
      date: '2026-09-17', createdAt: index, amount,
      unitsSold: 1, unitSalesPrice: amount, vatPaid: amount * 0.075,
    })),
    { id: 'return-one', type: 'return_inward', date: '2026-09-17', createdAt: 4, amount: 7_127, unitsSold: 1, unitSalesPrice: 7_127 },
    { id: 'return-two', type: 'return_inward', date: '2026-09-17', createdAt: 5, amount: 14_254, unitsSold: 2, unitSalesPrice: 7_127 },
  ] as any;
  assert.equal(calcSalesExcludingVAT(entries), 464_600);
  assert.equal(calcDashboardRevenue(entries), 443_219);
  assert.equal(calcNetRevenue(entries), 476_460.42);
});

function makeEntry(overrides: Partial<Entry> & Pick<Entry, 'id' | 'type' | 'date'>): Entry {
  return {
    amount: 0, category: '', notes: '', createdAt: 0,
    ...overrides,
  };
}

function makeProduct(stockQty: number, stockCost: number, costPrice = 100): Product {
  return {
    id: 'product-1', name: 'Product', costPrice, industry: '', markup: 0,
    suggestedPrice: 0, date: '2025-01-01', createdAt: 0, stockQty, stockCost,
  };
}

test('September P&L matches dashboard revenue while keeping VAT separate', () => {
  const entries = [
    makeEntry({ id: 'sale', type: 'sale', date: '2026-09-29', amount: 464_600, unitsSold: 1, unitSalesPrice: 464_600, vatPaid: 34_845 }),
    makeEntry({ id: 'return', type: 'return_inward', date: '2026-09-29', amount: 21_381, unitsSold: 1, unitSalesPrice: 21_381, returnVat: 1_603.575 }),
  ];
  const pnl = buildPnLReport(entries, entries, [], '2026-09-29');
  assert.equal(pnl.revenue, 476_460.42);
  assert.ok(Math.abs(pnl.vatPassThrough - 33_241.42) < 0.001);
  assert.ok(Math.abs((pnl.revenue - pnl.vatPassThrough) - 443_219) < 0.001);
  assert.equal(pnl.statementRevenue, 443_219);
  assert.ok(Math.abs(pnl.statementRevenue - (pnl.revenue - pnl.vatPassThrough)) < 0.001);
  assert.equal(entries[1].amount, 21_381); // Full customer refund is untouched.
  assert.ok(Math.abs(pnl.grossProfit - (443_219 - pnl.cost)) < 0.001);
});

test('landed supplier return separates supplier credit from return expense', () => {
  const purchase = makeEntry({ id: 'purchase', type: 'purchase', date: '2026-09-17', productId: 'product-1', unitsPurchased: 10, unitPurchasePrice: 100, amount: 1000, carriageInward: 50, handlingCost: 20 });
  const returned = makeEntry({ id: 'return', type: 'return_outward', date: '2026-09-17', productId: 'product-1', createdAt: 2, unitsSold: 2, amount: 200, cogsAmount: 200, baseCostSnapshot: 100, returnLandedCost: 214 });
  const entries = [purchase, returned];
  const products = [makeProduct(8, 800)];
  assert.equal(calcCostBalance(entries, products), 856);
  assert.equal(calcStockValue(products, entries), 856);
  assert.equal(calcInventoryValueAsOf(products, entries, '2026-09-17'), 856);
  assert.equal(getSupplierReturnExpense(returned), 14);
  assert.equal(calcDirectExpensesForEntries(entries), 14);
  const pnl = buildPnLReport(entries, entries, products, '2026-09-17');
  assert.equal(pnl.cost, 0);
  assert.equal(pnl.operatingExpenses, 14);
  assert.equal(pnl.profitBeforeTax, -14);
  assert.deepEqual(pnl.itemizedOperatingExpenses, [{ label: 'Supplier return expense', value: 14 }]);
  assert.equal(calcCostBalance([purchase, { ...returned, returnLandedCost: undefined }], products), 870);
  const octoberReturn = { ...returned, date: '2026-10-03' };
  const october = buildPnLReport([purchase, octoberReturn], [octoberReturn], products, '2026-10-31', '2026-10-01');
  assert.equal(october.openingStock, 1070);
  assert.equal(october.purchases, -214);
  assert.equal(october.closingStock, 856);
  assert.equal(october.cost, 0);
  assert.equal(october.operatingExpenses, 14);
  assert.equal(october.profitBeforeTax, -14);
});

test('corrected supplier return keeps base-cost credit, landed cost, and original-credit audit separate', () => {
  const returned = makeEntry({
    id: 'corrected-return',
    type: 'return_outward',
    date: '2026-09-17',
    unitsSold: 1,
    baseCostSnapshot: 5_000,
    amount: 5_000,
    unitSalesPrice: 5_000,
    returnLandedCost: 5_100,
    supplierCreditOriginalAmount: 5_100,
    supplierCreditCorrectionAt: 1_800_000_000_000,
  });
  assert.equal(returned.amount, 5_000);
  assert.equal(returned.supplierCreditOriginalAmount, 5_100);
  assert.equal(returned.returnLandedCost, 5_100);
  assert.equal(getSupplierReturnExpense(returned), 100);
});

test('P&L carries historical opening stock across periods without rewriting inventory', () => {
  const entries = [
    makeEntry({ id: 'prior-stock', type: 'opening_stock', date: '2026-08-31', amount: 16_000 }),
    makeEntry({ id: 'first-day-stock', type: 'opening_stock', date: '2026-09-01', amount: 1_000 }),
    makeEntry({ id: 'purchase', type: 'purchase', date: '2026-09-02', amount: 2_000 }),
  ];
  const september = entries.filter(entry => entry.date >= '2026-09-01');
  const pnl = buildPnLReport(entries, september, [], '2026-09-29', '2026-09-01');
  assert.equal(calcInventoryValueAsOf([], entries, '2026-09-29'), 19_000);
  assert.deepEqual([pnl.openingStock, pnl.purchases, pnl.closingStock, pnl.cost], [16_000, 2_000, 19_000, 0]);
  assert.equal(buildPnLReport(entries, [], [], '2026-10-31', '2026-10-01').openingStock, 19_000);
});

test('VAT is reported separately and P&L uses dashboard-basis revenue', () => {
  const entries = [
    makeEntry({
      id: 'cash-sale', type: 'sale', date: '2025-01-10',
      amount: 107.5, unitsSold: 1, unitSalesPrice: 107.5, vatPaid: 7.5,
    }),
    makeEntry({
      id: 'credit-sale', type: 'credit_sale', date: '2025-01-10',
      amount: 215, unitsSold: 2, unitSalesPrice: 107.5, vatPaid: 15,
    }),
    makeEntry({
      id: 'return-inward', type: 'return_inward', date: '2025-01-10',
      amount: 53.75, unitsSold: 1, unitSalesPrice: 53.75, returnVat: 3.75,
    }),
    makeEntry({
      id: 'debtor-payment', type: 'credit_sale_payment', date: '2025-01-10',
      amount: 80, linkedCreditEntryId: 'credit-sale',
    }),
  ];

  assert.equal(getEntryVAT({
    amount: 49_450, unitsSold: 2, unitSalesPrice: 24_725, vatPaid: 4_000,
  }), 3_708.75);
  assert.equal(getSaleValue({
    amount: 49_450, unitsSold: 2, unitSalesPrice: 24_725, vatPaid: 4_000,
  }), 49_450);
  assert.equal(getEntryVAT(entries[0]), 8.06);
  assert.equal(getEntryVAT(entries[1]), 16.13);
  assert.equal(getEntryVAT(entries[2]), 4.03);
  assert.equal(calcTotalSales(entries), 346.69);
  assert.equal(calcCashSales(entries), 115.56);
  assert.ok(Math.abs(calcNetRevenue(entries) - 288.91) < 0.001);
  assert.ok(Math.abs(calcSalesVATPassThrough(entries) - 20.16) < 0.001);
  const ledger = buildVATLedger(entries);
  assert.equal(ledger.find(row => row.entry.id === 'credit-sale')?.vatAmount, 16.13);
  assert.equal(ledger.find(row => row.entry.id === 'return-inward')?.vatAmount, 4.03);

  const reportWithPayment = buildPnLReport(entries, entries, [], '2025-01-31');
  const entriesWithoutPayment = entries.filter(entry => entry.type !== 'credit_sale_payment');
  const reportWithoutPayment = buildPnLReport(entriesWithoutPayment, entriesWithoutPayment, [], '2025-01-31');
  assert.ok(Math.abs(reportWithPayment.revenue - 288.91) < 0.001);
  assert.ok(Math.abs(reportWithPayment.vatPassThrough - 20.16) < 0.001);
  assert.equal(reportWithPayment.profitBeforeTax, 268.75);
  assert.equal(reportWithPayment.revenue, reportWithoutPayment.revenue);
  assert.equal(reportWithPayment.profitBeforeTax, reportWithoutPayment.profitBeforeTax);
});

test('reported revenue reconciles gross Total Sales less gross Returns Inward', () => {
  const entries = [
    makeEntry({ id: 'cash', type: 'sale', date: '2025-01-01', amount: 300_000, vatPaid: 22_500 }),
    makeEntry({ id: 'credit', type: 'credit_sale', date: '2025-01-02', amount: 129_755, vatPaid: 9_731.625 }),
    makeEntry({ id: 'return', type: 'return_inward', date: '2025-01-03', amount: 21_381, returnVat: 1_603.575 }),
    makeEntry({ id: 'vat-cash', type: 'expense', date: '2025-01-01', amount: 22_222, category: 'VAT Paid', notes: 'VAT on Sale ID: cash' }),
  ];
  assert.equal(calcTotalSales(entries), 461_986.63);
  assert.equal(calcSalesExcludingVAT(entries), 429_755);
  assert.equal(calcNetRevenue(entries), 439_002.05);
  const pnl = buildPnLReport(entries, entries, [], '2025-01-31');
  assert.equal(pnl.revenue, 439_002.05);
  assert.ok(Math.abs(pnl.vatPassThrough - 30_628.05) < 0.001);
  assert.equal(pnl.grossProfit, 408_374);
  const vatRows = buildVATLedger(entries);
  assert.ok(Math.abs(vatRows.filter(row => row.direction === 'addition').reduce((sum, row) => sum + row.vatAmount, 0) - 32_231.63) < 0.001);
  assert.equal(vatRows.filter(row => row.direction === 'deduction').reduce((sum, row) => sum + row.vatAmount, 0), 1_603.58);
});

test('direct cash flow reconciles opening and closing cash including returns and debt settlements', () => {
  const entries = [
    makeEntry({ id: 'prior-sale', type: 'sale', date: '2025-01-01', amount: 1_000 }),
    makeEntry({ id: 'prior-expense', type: 'expense', date: '2025-01-02', amount: 200, category: 'Rent' }),
    makeEntry({ id: 'prior-vat-accrual', type: 'expense', date: '2025-01-03', amount: 99, category: 'VAT Paid', notes: 'VAT on Sale ID: prior-sale' }),
    makeEntry({ id: 'cash-sale', type: 'sale', date: '2025-02-01', amount: 500 }),
    makeEntry({ id: 'debtor-payment', type: 'credit_sale_payment', date: '2025-02-02', amount: 300 }),
    makeEntry({ id: 'customer-refund', type: 'return_inward', date: '2025-02-03', amount: 50 }),
    makeEntry({ id: 'supplier-settlement', type: 'return_outward', date: '2025-02-04', amount: 40 }),
    makeEntry({ id: 'cash-purchase', type: 'purchase', date: '2025-02-05', amount: 100 }),
    makeEntry({ id: 'creditor-payment', type: 'credit_purchase_payment', date: '2025-02-06', amount: 60 }),
    makeEntry({ id: 'rent', type: 'expense', date: '2025-02-07', amount: 30, category: 'Rent' }),
    makeEntry({ id: 'equipment', type: 'expense', date: '2025-02-07', amount: 25, category: 'Equipment' }),
    makeEntry({ id: 'vat-paid', type: 'expense', date: '2025-02-08', amount: 20, category: 'VAT Paid', notes: 'VAT on Sale ID: cash-sale' }),
  ];
  const flow = buildDirectCashFlow(entries, entries.filter(entry => entry.date >= '2025-02-01'), '2025-02-01');
  assert.equal(flow.openingCash, 800);
  assert.equal(flow.totalOperatingReceipts, 840);
  assert.equal(flow.totalOperatingPayments, 240);
  assert.equal(flow.netOperatingCashFlow, 600);
  assert.equal(flow.investingCashFlow, -25);
  assert.equal(flow.financingCashFlow, 0);
  assert.equal(flow.netChangeInCash, 575);
  assert.equal(flow.closingCash, 1_375);
  assert.equal(buildDirectCashFlow([], [], '2025-02-01').openingCash, 0);
});

test('unreconstructable legacy sales retain their saved VAT snapshots', () => {
  assert.equal(getEntryVAT(makeEntry({
    id: 'legacy-sale', type: 'sale', date: '2025-01-10', amount: 100, vatPaid: 6,
  })), 6);
  assert.equal(getEntryVAT(makeEntry({
    id: 'legacy-return', type: 'return_inward', date: '2025-01-10', amount: 50, returnVat: 3,
  })), 3);
});

test('historical credit-payment allocations are rebuilt from sale and payment history', () => {
  const sale = makeEntry({
    id: 'credit-sale-allocation', type: 'credit_sale', date: '2025-01-10',
    amount: 49_450, unitsSold: 2, unitSalesPrice: 24_725, vatPaid: 3_450,
  });
  const firstPayment = makeEntry({
    id: 'payment-one', type: 'credit_sale_payment', date: '2025-01-11',
    amount: 24_725, linkedCreditEntryId: sale.id, allocatedVat: 1_725, createdAt: 1,
  });
  const secondPayment = makeEntry({
    id: 'payment-two', type: 'credit_sale_payment', date: '2025-01-12',
    amount: 24_725, linkedCreditEntryId: sale.id, allocatedVat: 1_725, createdAt: 2,
  });
  const completeHistory = [sale, firstPayment, secondPayment];

  const paymentRows = buildVATLedger(
    [firstPayment, secondPayment],
    [],
    completeHistory,
  ).filter(row => row.direction === 'allocation');
  assert.deepEqual(paymentRows.map(row => row.vatAmount), [1_725, 1_725]);
  assert.equal(paymentRows.reduce((sum, row) => sum + row.vatAmount, 0), 3_450);
  assert.equal(
    getOutstandingCredits(completeHistory, 'sale', undefined, true)[0].vatPaidToDate,
    3_450,
  );

  // When the original sale is absent from the available history, retain the
  // saved payment allocation rather than inventing a replacement.
  assert.equal(buildVATLedger([firstPayment])[0].vatAmount, 1_725);
});

test('stock value uses weighted landed cost without adding ancillary charges twice', () => {
  const purchase = makeEntry({
    id: 'purchase-1', type: 'purchase', date: '2025-01-10', productId: 'product-1',
    amount: 1000, unitsPurchased: 10, unitPurchasePrice: 100,
    materialCosts: [100], carriageInward: 50, handlingCost: 50,
  });
  const product = makeProduct(8, 800);
  assert.equal(calcStockValue([product], [purchase]), 960);
  assert.equal(calcCostBalance([purchase]), 1200);
  const lines = getStockValueBreakdown([product], [purchase]);
  assert.equal(lines[0].quantity, 8);
  assert.equal(lines[0].unitCost, 120);
  assert.equal(lines[0].totalCost, 960);
  assert.equal(lines.reduce((sum, row) => sum + row.totalCost, 0), calcStockValue([product], [purchase]));
});

test('P&L cost of sales is period purchases minus historical closing stock', () => {
  const entries = [
    makeEntry({
      id: 'purchase-1', type: 'purchase', date: '2025-01-10', productId: 'product-1',
      amount: 1000, unitsPurchased: 10, unitPurchasePrice: 100,
      materialCosts: [100], carriageInward: 50, handlingCost: 50,
    }),
    makeEntry({
      id: 'supplier-payment', type: 'credit_purchase_payment', date: '2025-01-11',
      amount: 500, linkedCreditEntryId: 'purchase-1',
    }),
    makeEntry({
      id: 'sale', type: 'sale', date: '2025-01-12', amount: 1000,
    }),
  ];
  const report = buildPnLReport(entries, entries, [makeProduct(8, 800)], '2025-01-31');
  assert.equal(report.cost, 240); // Opening stock 0 + purchases 1,200 - closing stock 960.
  assert.equal(report.grossProfit, 760);
  assert.equal(report.profitAfterTax, 760); // PIT exempt band covers this profit.
});

test('monthly PIT pays only the increase in annual year-to-date liability', () => {
  const entries = [
    makeEntry({ id: 'june-income', type: 'sale', date: '2026-06-03', amount: 900_000 }),
    makeEntry({ id: 'september-income', type: 'sale', date: '2026-09-03', amount: 200_000 }),
  ];
  const report = buildPnLReport(entries, [entries[1]], [], '2026-09-30', '2026-09-01');
  assert.equal(report.profitBeforeTax, 200_000);
  assert.equal(report.tax, 0);
  assert.equal(report.estimatedTax, 30_000);
  assert.equal(report.profitAfterTax, 200_000);
});

test('historical closing stock excludes later receipts and uses cutoff landed costs', () => {
  const entries = [
    makeEntry({
      id: 'old-purchase', type: 'purchase', date: '2025-01-10', productId: 'product-1',
      amount: 1000, unitsPurchased: 10, unitPurchasePrice: 100, handlingCost: 100,
    }),
    makeEntry({
      id: 'new-purchase', type: 'credit_purchase', date: '2025-02-10', productId: 'product-1',
      amount: 1000, unitsPurchased: 5, unitPurchasePrice: 200,
    }),
  ];
  assert.equal(calcInventoryValueAsOf([makeProduct(15, 2000)], entries, '2025-01-31'), 1100);
});

test('historical product value excludes a later linked opening-stock adjustment', () => {
  const opening = makeEntry({
    id: 'late-opening', type: 'opening_stock', date: '2025-02-10',
    productId: 'product-1', amount: 100,
  });
  const product = makeProduct(4, 500);
  assert.equal(calcInventoryValueAsOf([product], [opening], '2025-01-31'), 400);
  assert.equal(getStockValueBreakdown([product], [opening], '2025-01-31')[0].totalCost, 400);
});

test('stock valuation retains fallbacks for products and legacy ledgers without purchase history', () => {
  assert.equal(calcStockValue([makeProduct(4, 320)], []), 320);
  const legacyPurchase = makeEntry({
    id: 'legacy-purchase', type: 'purchase', date: '2025-01-10',
    amount: 1000, unitsPurchased: 10, unitPurchasePrice: 100, carriageInward: 50,
  });
  const legacySale = makeEntry({
    id: 'legacy-sale', type: 'sale', date: '2025-01-11',
    amount: 500, unitsSold: 2, cogsAmount: 200,
  });
  assert.equal(calcStockValue([], [legacyPurchase, legacySale]), 840);
});

test('live stockCost remains the base value and opening stock cannot inflate ancillary premium', () => {
  const purchase = makeEntry({
    id: 'small-purchase', type: 'purchase', date: '2025-01-10', productId: 'product-1',
    amount: 200, unitsPurchased: 2, unitPurchasePrice: 100, handlingCost: 20,
  });
  assert.equal(calcStockValue([makeProduct(12, 1200)], [purchase]), 1220);
  // Even after a base-cost revaluation, only the tracked 2 purchased units
  // carry the ₦20 handling premium; the other 10 units are opening stock.
  assert.equal(calcStockValue([makeProduct(12, 1500)], [purchase]), 1520);
});

test('ancillary inventory cost is removed on sell-out and supplier returns without product documents', () => {
  const purchase = makeEntry({
    id: 'legacy-buy', type: 'purchase', date: '2025-01-10', productId: 'missing-product',
    amount: 1000, unitsPurchased: 10, unitPurchasePrice: 100,
    materialCosts: [100], carriageInward: 50, handlingCost: 50,
  });
  const fullSale = makeEntry({
    id: 'legacy-sale', type: 'sale', date: '2025-01-11', productId: 'missing-product',
    amount: 2000, unitsSold: 10, cogsAmount: 1000,
  });
  assert.equal(calcStockValue([], [purchase, fullSale]), 0);
  assert.equal(calcInventoryValueAsOf([], [purchase, fullSale], '2025-01-10'), 1200);
  assert.equal(calcInventoryValueAsOf([], [purchase, fullSale], '2025-01-11'), 0);

  const supplierReturn = makeEntry({
    id: 'legacy-return', type: 'return_outward', date: '2025-01-11', productId: 'missing-product',
    amount: 0, unitsSold: 5, cogsAmount: 500,
  });
  assert.equal(calcStockValue([], [purchase, supplierReturn]), 600);
});

test('return inward after sell-out restores the last ancillary rate before later receipts and sales', () => {
  const entries = [
    makeEntry({
      id: 'first-buy', type: 'purchase', date: '2025-01-01', productId: 'product-1',
      amount: 1000, unitsPurchased: 10, unitPurchasePrice: 100, handlingCost: 200,
    }),
    makeEntry({
      id: 'sell-all', type: 'sale', date: '2025-01-02', productId: 'product-1',
      amount: 2000, unitsSold: 10, cogsAmount: 1000,
    }),
    makeEntry({
      id: 'customer-return', type: 'return_inward', date: '2025-01-03', productId: 'product-1',
      amount: 400, unitsSold: 2, cogsAmount: 200,
    }),
    makeEntry({
      id: 'second-buy', type: 'credit_purchase', date: '2025-01-04', productId: 'product-1',
      amount: 800, unitsPurchased: 8, unitPurchasePrice: 100, handlingCost: 160,
    }),
    makeEntry({
      id: 'sell-again', type: 'sale', date: '2025-01-05', productId: 'product-1',
      amount: 1000, unitsSold: 5, cogsAmount: 500,
    }),
  ];
  assert.equal(calcStockValue([], entries), 600);
  assert.equal(calcStockValue([makeProduct(5, 500)], entries), 600);
  assert.equal(calcInventoryValueAsOf([], entries, '2025-01-02'), 0);
  assert.equal(calcInventoryValueAsOf([], entries, '2025-01-03'), 240);
  assert.equal(calcInventoryValueAsOf([makeProduct(5, 500)], entries, '2025-01-03'), 240);
});

test('legacy aggregate purchases normalize base and ancillary costs exactly once', () => {
  const purchaseAmountEntry = makeEntry({
    id: 'purchase-amount', type: 'purchase', date: '2025-01-01', productId: 'product-1',
    amount: 130, purchaseAmount: 130, totalLandedCost: 145,
    materialCosts: [30], carriageInward: 10, handlingCost: 5, unitsPurchased: 1,
  });
  const totalLandedEntry = makeEntry({
    id: 'total-landed', type: 'purchase', date: '2025-01-01', productId: 'product-2',
    amount: 145, totalLandedCost: 145,
    materialCosts: [30], carriageInward: 10, handlingCost: 5, unitsPurchased: 1,
  });
  assert.equal(calcCostBalance([purchaseAmountEntry]), 145);
  assert.equal(calcCostBalance([totalLandedEntry]), 145);
  assert.equal(calcStockValue([makeProduct(1, 100)], [purchaseAmountEntry]), 145);
  assert.equal(calcStockValue([], [totalLandedEntry]), 145);
});

test('historical stock valuation excludes future-dated product receipts', () => {
  const entries = [
    makeEntry({
      id: 'today-buy', type: 'purchase', date: '2025-01-01', productId: 'product-1',
      amount: 500, unitsPurchased: 5, unitPurchasePrice: 100, handlingCost: 50, stockDelta: 5,
    }),
    makeEntry({
      id: 'future-buy', type: 'purchase', date: '2025-01-02', productId: 'product-1',
      amount: 500, unitsPurchased: 5, unitPurchasePrice: 100, handlingCost: 100, stockDelta: 5,
    }),
  ];
  assert.equal(calcInventoryValueAsOf([makeProduct(10, 1000)], entries, '2025-01-01'), 550);
});

test('zero-premium customer returns retain tracked units for later ancillary allocation', () => {
  const entries = [
    makeEntry({
      id: 'plain-buy', type: 'purchase', date: '2025-01-01', productId: 'product-1',
      amount: 200, unitsPurchased: 2, unitPurchasePrice: 100,
    }),
    makeEntry({
      id: 'plain-sellout', type: 'sale', date: '2025-01-02', productId: 'product-1',
      amount: 400, unitsSold: 2, cogsAmount: 200,
    }),
    makeEntry({
      id: 'plain-return', type: 'return_inward', date: '2025-01-03', productId: 'product-1',
      amount: 100, unitsSold: 1, cogsAmount: 100,
    }),
    makeEntry({
      id: 'premium-buy', type: 'purchase', date: '2025-01-04', productId: 'product-1',
      amount: 100, unitsPurchased: 1, unitPurchasePrice: 100, handlingCost: 100,
    }),
    makeEntry({
      id: 'premium-sale', type: 'sale', date: '2025-01-05', productId: 'product-1',
      amount: 200, unitsSold: 1, cogsAmount: 100,
    }),
  ];
  assert.equal(calcStockValue([], entries), 150);
  assert.equal(calcStockValue([makeProduct(1, 100)], entries), 150);
});