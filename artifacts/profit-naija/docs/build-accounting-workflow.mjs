import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import {
  buildDirectCashFlow, buildPnLReport, buildVATLedger, getGrossSaleValue,
  getSaleValue, getOutstandingCredits, getSupplierReturnExpense,
} from "../lib/utils/formulas.ts";

const escape = value => String(value).replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = n => `₦${n.toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
const native = JSON.parse(await readFile(new URL("../app.json", import.meta.url), "utf8")).expo;
assert.equal(native.name, "ProfitNaija");

// Fictional records, used only to check this guide against the current formulas.
// Earlier cash receipts establish opening cash; this is not an opening-capital feature.
const entry = (id, type, amount, fields = {}) => ({
  id, type, amount, date: "2026-10-06", createdAt: 1, ...fields,
});
const earlier = entry("example-earlier", "sale", 150000, { date: "2026-09-30" });
const purchase = entry("example-purchase", "purchase", 105000, {
  productId: "example-product", unitsPurchased: 10, unitPurchasePrice: 10000,
  carriageInward: 5000, totalLandedCost: 105000, purchaseVAT: 0, withholdingTax: 0,
});
const sale = entry("example-sale", "credit_sale", 64500, {
  productId: "example-product", unitsSold: 4, unitSalesPrice: 15000,
  vatPaid: 4500, vatExclusive: true, cogsAmount: 40000,
  partyName: "Example Customer", documentType: "invoice",
});
const payment = entry("example-payment", "credit_sale_payment", 20000, {
  linkedCreditEntryId: sale.id, partyName: "Example Customer",
});
const expense = entry("example-expense", "expense", 5000, { category: "Rent" });
const scoped = [purchase, sale, payment, expense];
const all = [earlier, ...scoped];
const product = {
  id: "example-product", name: "Example Product", stockQty: 6,
  costPrice: 10000, stockCost: 60000, createdAt: 1,
  date: "2026-10-06", industry: "General", markup: 50, suggestedPrice: 15000,
  sourceEntryId: purchase.id,
};
const pnl = buildPnLReport(all, scoped, [product], "2026-10-06", "2026-10-01");
const cash = buildDirectCashFlow(all, scoped, "2026-10-01");
assert.equal(getSaleValue(sale), 60000);
assert.equal(getGrossSaleValue(sale), 64500);
assert.equal(pnl.statementRevenue, 60000);
assert.equal(pnl.purchases, 105000);
assert.equal(pnl.closingStock, 63000);
assert.equal(pnl.cost, 42000);
assert.equal(pnl.profitBeforeTax, 13000);
assert.equal(cash.openingCash, 150000);
assert.equal(cash.netChangeInCash, -90000);
assert.equal(cash.closingCash, 60000);
const credits = getOutstandingCredits(all, "sale");
assert.equal(credits.find(c => c.originalEntry.id === sale.id)?.remainingBalance, 44500);
const vat = buildVATLedger(scoped);
assert.equal(vat.filter(row => row.direction === "addition").reduce((s, row) => s + row.vatAmount, 0), 4500);
assert.equal(vat.filter(row => row.direction === "allocation").length, 1);
assert.equal(getSupplierReturnExpense(entry("example-return", "return_outward", 200, { returnLandedCost: 214 })), 14);
const carriedStockReport = buildPnLReport(
  [{ ...purchase, date: "2026-09-29" }], [],
  [{ ...product, date: "2026-09-29", stockQty: 10, stockCost: 100000 }],
  "2026-10-06", "2026-10-01",
);
assert.equal(carriedStockReport.openingStock, 0, "Update this guide if the opening-stock convention changes");
assert.equal(carriedStockReport.cost, -105000);
console.log("PASS worked example against actual mobile accounting formulas");

const text = (x, y, value, size = 16, weight = 400, color = "#244636") =>
  `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${color}">${escape(value)}</text>`;
const box = (x, y, w, h, fill = "#ffffff", stroke = "#c7d9cf") =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" fill="${fill}" stroke="${stroke}"/>`;
const node = (x, y, title, lines, fill = "#ffffff") => box(x, y, 318, 166, fill)
  + text(x + 20, y + 34, title, 21, 700)
  + lines.map((line, i) => text(x + 20, y + 64 + 24 * i, line, 15)).join("");
const line = (x1, y1, x2, y2, arrow = false) =>
  `<path d="M${x1},${y1} L${x2},${y2}" fill="none" stroke="#668b77" stroke-width="2"${arrow ? ' marker-end="url(#arrow)"' : ""}/>`;
const centers = [195, 545, 895, 1245];
const bus = (fromY, busY, toY) => line(720, fromY, 720, busY)
  + line(195, busY, 1245, busY)
  + centers.map(x => line(x, busY, x, toY, true)).join("");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1440 1040" role="img" aria-labelledby="workflow-title workflow-desc">
<title id="workflow-title">ProfitNaija accounting workflow</title>
<desc id="workflow-desc">Verified business access leads to purchases, sales, debt payments and expenses or returns. Business records feed inventory, profit, debt and tax or cash calculations, then dashboards, reports and invoices. Supporting services include backup and access management.</desc>
<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="#668b77"/></marker></defs>
<rect width="1440" height="1040" fill="#f6f8f3"/>
<g font-family="Arial, sans-serif">
${text(36, 52, "ProfitNaija · Accounting workflow", 32, 700, "#0e462b")}
${text(36, 82, "From everyday business records to inventory, profit, balances, taxes and reports", 17)}
${box(36, 110, 1368, 96, "#e3eee6")}
${text(58, 146, "1 · Enter the right business workspace", 23, 700)}
${text(58, 174, "Verified account → profile and terms → trial / subscription access → owner’s business records", 18)}
${bus(206, 238, 260)}
${node(36, 260, "2 · Purchases", ["Base purchase + landed costs", "Add stock; record supplier balance", "Cash purchase: cash outflow", "Supplier VAT/WHT follow app rules"])}
${node(386, 260, "2 · Sales & invoices", ["Quantity × VAT-exclusive unit price", "Add VAT once to invoice total", "Reduce stock at carrying cost", "Cash sale or customer credit"])}
${node(736, 260, "2 · Debt payments", ["Customer pays: debt ↓, cash ↑", "Supplier paid: debt ↓, cash ↓", "Link payment to original credit", "No second sale or purchase cost"])}
${node(1086, 260, "2 · Expenses & returns", ["Expenses reduce business profit", "Customer return: reverse sale/VAT", "Supplier return: reduce stock/cost", "Track supplier return expenses"])}
${centers.map(x => line(x, 426, x, 454)).join("")}
${line(195, 454, 1245, 454)}${line(720, 454, 720, 480, true)}
${box(36, 480, 1368, 88, "#0e462b", "#0e462b")}
${text(58, 516, "3 · Business records connect the operations", 23, 700, "#ffffff")}
${text(58, 545, "Entries + products + customer/supplier links, scoped to the account; linked credit changes use server validation.", 17, 400, "#e5efe8")}
${bus(568, 594, 616)}
${node(36, 616, "4 · Inventory", ["Available quantity and cost value", "Allocate remaining landed costs", "Sales remove goods at cost", "Closing stock at the chosen date"], "#e3eee6")}
${node(386, 616, "4 · Revenue & profit", ["Revenue = base sales − returns", "Cost = purchases − closing stock*", "Gross profit − expenses − interest", "Then estimate period PIT"], "#e3eee6")}
${node(736, 616, "4 · Customer/supplier debt", ["Customer debt uses VAT-inclusive bill", "Payments reduce linked balances", "Supplier debt uses recorded bill", "Read balances as of period end"], "#e3eee6")}
${node(1086, 616, "4 · Taxes & cash", ["VAT / WHT / estimated PIT", "Cash from recorded movements", "Cash is different from profit", "See report assumptions below"], "#e3eee6")}
${centers.map(x => line(x, 782, x, 812)).join("")}
${line(195, 812, 1245, 812)}${line(720, 812, 720, 836, true)}
${box(36, 836, 1368, 96, "#ffffff")}
${text(58, 873, "5 · Dashboard, reports & customer documents", 23, 700)}
${text(58, 902, "Profit & loss · Cash flow · Debtors/creditors · VAT/WHT/PIT · Returns · Print/PDF/share · Invoices", 18)}
${box(36, 956, 1368, 62, "#fff4de", "#dcc48f")}
${text(58, 982, "6 · Supporting services — not extra business sales", 19, 700)}
${text(58, 1006, "Backup/restore · Plan access · Admin/partner portals · Secure invoice sharing · Website/store discovery", 16)}
${text(36, 1033, "* Current P&L opening stock = 0. Cash flow assumes cash return settlements. Source-based guide, not an audit.", 14)}
</g></svg>`;

const examples = [
  ["Opening cash", money(cash.openingCash), "Reconstructed from earlier recorded receipts in this fictional example; not imported bank cash."],
  ["Buy 10 units", money(pnl.purchases), "10 × ₦10,000 base cost + ₦5,000 carriage. Supplier does not charge VAT, so purchase VAT/WHT are zero in this example."],
  ["Sell 4 units on credit", money(pnl.statementRevenue), "4 × ₦15,000 VAT-exclusive selling price. Revenue and stock movement happen now, before collection."],
  ["Sales VAT", money(4500), "7.5% × ₦60,000; added once. Customer invoice total is ₦64,500."],
  ["Collect from customer", money(20000), "Cash increases and debt falls; no new revenue or second VAT recognition."],
  ["Customer still owes", money(44500), "₦64,500 invoice − ₦20,000 payment. VAT is part of customer debt."],
  ["Closing stock", money(pnl.closingStock), "6 units remain at ₦10,500 landed cost each."],
  ["Cost of sales", money(pnl.cost), "₦105,000 purchases − ₦63,000 closing stock = ₦42,000; example has no opening inventory."],
  ["Gross profit", money(pnl.grossProfit), "₦60,000 revenue − ₦42,000 cost of sales."],
  ["Record rent expense", money(5000), "Reduces both profit and cash in this example."],
  ["Profit before tax", money(pnl.profitBeforeTax), "₦18,000 gross profit − ₦5,000 rent. PIT depends on year-to-date figures and is not illustrated here."],
  ["Net cash movement", money(cash.netChangeInCash), "₦20,000 collection − ₦105,000 purchase − ₦5,000 rent = −₦90,000."],
  ["Closing recorded cash", money(cash.closingCash), "₦150,000 opening cash − ₦90,000 movement. Profit, cash and debt are different amounts."],
];

const sections = [
  ["purchases", "Purchases → inventory → supplier balances", [
    "Record cash or credit purchases with quantity, base unit cost and applicable materials, carriage and handling. Goods are recognised when received, not again when the supplier is paid.",
    "Inventory value carries the remaining units’ base cost and allocated landed costs. Unsold goods remain in stock; a purchase is not automatically all cost of goods sold.",
    "The configured supplier-tax rule is purchase VAT 7.5% and WHT 5% of quantity × base unit cost when supplier VAT is enabled; otherwise both are zero. These are the app’s product rules, not advice that every supplier transaction has this statutory treatment.",
    "Keep the supplier bill, ancillary costs, inventory value and WHT obligation distinct. Use the saved credit bill as the debt basis; don’t infer payable from stock value.",
  ]],
  ["sales", "Sales → stock movement → revenue → invoice", [
    "All entered selling unit prices exclude VAT, including historical invoices. Base sales = quantity × unit price; sales VAT = 7.5% of base sales; customer total = base sales + VAT.",
    "Both cash and credit sales recognise base revenue and remove stock. Cash sales also record a receipt; credit sales create customer debt until payments are collected.",
    "Sales is the gross base-sales figure before returns. Revenue is base sales less customer returns, excluding VAT. Cost of sales uses purchase/stock costs—not selling prices.",
    "Invoices show base sales, separate VAT, full invoice total, paid amount and balance due. Issued pricing/contact details are snapshots; shared credit-invoice payment status reflects current linked payments.",
  ]],
  ["settlements", "Debt payments → cash and balances, not a second sale", [
    "Customer collections link to the original credit sale, increase cash and reduce the VAT-inclusive outstanding balance. They must not add new sales or recognise VAT again.",
    "Supplier payments link to the original credit purchase, reduce cash and settle the creditor. They do not buy the stock a second time or reduce stock quantity/value.",
    "Linked credit creates, edits and deletes use the authenticated server transaction boundary to guard balances, identity and stock history.",
    "Only the latest stock event can be changed directly under the historical-stock safety rules. After later stock activity, use a valid compensating correction instead of silently rewriting the earlier event.",
  ]],
  ["returns", "Expenses and returns → correctly matched adjustments", [
    "Manual business expenses reduce reported profit. Generated sale-VAT accrual entries are excluded from ordinary operating expenses. Interest on loans is presented separately in the P&L.",
    "Customer returns reverse the matching base revenue and VAT and restore the returned goods at the relevant purchase/landed carrying cost. Confirm the actual refund or credit settlement before relying on the cash-flow result.",
    "Supplier returns remove goods at allocated landed carrying cost. The supplier credit is separate; the difference is labelled Supplier return expenses, not silently kept in cost of sales as well.",
    "Example: returned goods carry ₦214 of landed cost; supplier credit is ₦200; Supplier return expenses are ₦14. Supplier credit is not automatically cash received.",
  ]],
  ["reports", "Records → selected-period reports and exports", [
    "Use the selected period consistently. Sales, expenses, movements and profit belong to the range; inventory and unpaid balances are positions as of its end. Confirm the same cutoffs in drill-downs and exports.",
    "The current management P&L explicitly sets opening stock to zero: cost of sales = purchases less closing stock. This is not the conventional carry-forward opening-stock method; see limitations below.",
    "Gross profit = net base revenue − cost of sales. Operating profit deducts operating expenses; profit before tax also deducts interest. Estimated period PIT is the change in year-to-date liability, rather than a fresh annual allowance every month.",
    "Current report views include profit & loss, direct cash flow, debtors, creditors, VAT, WHT, PIT and customer/supplier returns. Statement-specific print, PDF and sharing paths are present; end-to-end coverage is not certified by this guide.",
  ]],
  ["support", "How the other completed work connects", [
    "Discovery: website SEO and prepared Google Play/App Store copy lead people toward registration. Public store approval is a separate process, not part of the accounting calculation. The supplied Play Console screenshots show unfinished listing/pricing setup and a required closed test.",
    "Access: email verification, business profile/terms, trial and plan checks control entry to the business workspace. Native Google Play/RevenueCat and web Paystack flows are separate billing channels; entitlement consistency still needs release verification.",
    "Subscription charges control ProfitNaija access. They do not automatically become the merchant’s business sales; an actual software expense would need its own business record.",
    "Partners and admin: referral/agent rewards, subscription administration and platform revenue belong to their own portals. Do not combine them with a merchant’s trading ledger unless a real business transaction is explicitly recorded.",
    "Persistence: each account’s Firestore business records connect mobile and web. Cloud backups capture versioned per-user snapshots; restore merges by identity without deleting newer records. Scheduled work can catch up when the service/session is active—this is not a promise of an exact unattended run time.",
    "Sharing and privacy: customer-directory capture and invoice links support sales; secure links expose invoice fields, not private costs/profit. Token revocation, account deletion and plan-gated features need their own release checks.",
  ]],
];
const sectionHtml = sections.map(([id, title, paragraphs]) =>
  `<section id="${id}"><h2>${escape(title)}</h2>${paragraphs.map(p => `<p>${escape(p)}</p>`).join("")}</section>`).join("");
const sourcePaths = [
  "artifacts/profit-naija/lib/utils/formulas.ts",
  "artifacts/profit-naija/context/EntriesContext.tsx",
  "artifacts/profit-naija/lib/utils/invoice.ts",
  "artifacts/profit-naija/app/(tabs)/report.tsx",
  "artifacts/profit-naija-web/src/lib/utils/formulas.ts",
  "artifacts/profit-naija-web/src/pages/reports.tsx",
  "artifacts/api-server/src/routes/account.ts",
];
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>ProfitNaija — Accounting workflow guide</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f6f8f3;color:#173c2b;font:16px/1.65 Arial,sans-serif}
main{max-width:1480px;margin:auto;padding:32px 24px 56px}h1{font-size:clamp(27px,4vw,42px);line-height:1.15}
h2{font-size:25px;line-height:1.3;margin-top:0}h3{font-size:19px}p{max-width:100ch}
.eyebrow{font-weight:bold;letter-spacing:.08em;font-size:13px;text-transform:uppercase}.intro{max-width:900px}
.notice{padding:18px 22px;border-left:4px solid #af7e28;background:#fff4de;border-radius:6px;margin:20px 0}
.diagram{overflow:auto;border:1px solid #c7d9cf;border-radius:18px;background:#f6f8f3}
.diagram svg{display:block;width:100%;min-width:1000px;height:auto}.scroll-note{font-size:14px;color:#597363}
nav{display:flex;flex-wrap:wrap;gap:10px;margin:26px 0}nav a{border:1px solid #c7d9cf;padding:8px 13px;border-radius:30px;color:#17462d;text-decoration:none;background:white}
a:focus-visible{outline:3px solid #af7e28;outline-offset:3px}section{background:white;border:1px solid #d4e0d7;padding:26px;border-radius:14px;margin:22px 0;scroll-margin-top:16px}
.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;min-width:720px}th,td{text-align:left;padding:13px;border-bottom:1px solid #dbe4dd;vertical-align:top}
th{background:#e3eee6}td:nth-child(2){white-space:nowrap;font-weight:bold}.limits{border-color:#d8bd8a;background:#fffaf0}
li{margin-bottom:12px}code{overflow-wrap:anywhere;font-size:13px}footer{font-size:14px;color:#567061}
@media(max-width:600px){main{padding:24px 16px}section{padding:20px}h2{font-size:22px}}
@media print{body{background:white}main{padding:0}nav,.scroll-note{display:none}.diagram svg{min-width:0}section{break-inside:avoid;border-color:#ccc}.table-wrap{overflow:visible}table{min-width:0;font-size:12px}h1{font-size:28px}}
</style></head><body><main>
<div class="eyebrow">ProfitNaija · Business accounting explained</div><h1>How your business records connect</h1>
<p class="intro">A connected workflow for the current mobile and web app: purchases and sales move stock, credit transactions create balances, payments move cash, and those records feed profit, taxes, reports and invoices.</p>
<div class="notice"><strong>Source-based explanation, not a launch approval or audit.</strong> This guide changes no app data or calculations. The diagram describes code paths; a worked example is checked against the mobile formulas. That does not certify every mobile/web screen, billing journey, offline path or export. Known assumptions and unfinished verification are listed below.</div>
<div class="diagram">${svg}</div><p class="scroll-note">On a phone, scroll the diagram sideways to read the boxes. The detailed workflow below fits the screen. Use your browser’s Print → Save as PDF to keep a printable copy.</p>
<nav aria-label="Guide sections"><a href="#purchases">Purchases</a><a href="#sales">Sales & invoices</a><a href="#settlements">Debt payments</a><a href="#returns">Expenses & returns</a><a href="#reports">Reports</a><a href="#example">Worked example</a><a href="#support">Connected services</a><a href="#limitations">Limits & verification</a></nav>
${sectionHtml}
<section id="example"><h2>Worked example: profit is not the same as cash</h2>
<p><strong>Fictional records only.</strong> A business starts this reporting period with ₦150,000 of cash reconstructed from earlier recorded receipts and no opening inventory. It buys ten units, sells four on credit, receives a partial customer payment and pays rent. No supplier VAT/WHT applies to this example.</p>
<div class="table-wrap"><table><thead><tr><th>Step / result</th><th>Amount</th><th>Accounting effect</th></tr></thead><tbody>
${examples.map(([step, amount, effect]) => `<tr><td>${escape(step)}</td><td>${escape(amount)}</td><td>${escape(effect)}</td></tr>`).join("")}
</tbody></table></div><p><strong>The result:</strong> profit before tax is ₦13,000, recorded closing cash is ₦60,000, stock is ₦63,000 and the customer still owes ₦44,500. These numbers measure different things; they should not be forced to match.</p></section>
<section class="limits" id="limitations"><h2>Important assumptions and remaining checks</h2><ul>
<li><strong>Management P&L opening stock:</strong> the current formula fixes opening stock at zero. Cost is purchases minus closing stock. With carried-forward inventory, this can differ materially from conventional period cost of sales and can even show a negative cost. This guide records the current rule; it does not change it or present the report as a certified statutory statement.</li>
<li><strong>Cash-flow reconstruction:</strong> opening cash comes from earlier recorded movements; missing earlier history means zero, not an independently verified bank balance. Customer returns are assumed cash refunds, and supplier returns cash settlements. A supplier credit or non-cash return needs reconciliation before treating that report as actual cash.</li>
<li><strong>Equipment and financing:</strong> recorded EQUIPMENT expenses are investing outflows in cash flow but remain expenses in the current P&L. Financing flows are zero in the current cash-flow model. Full fixed-asset depreciation, owner funding, loan principal and drawings ledgers are not demonstrated here.</li>
<li><strong>Tax estimates:</strong> VAT/WHT rules and PIT calculations describe current product logic, not individual tax advice, automatic filing or proof of tax payment. Generated VAT accruals and PIT estimates are not themselves cash payments.</li>
<li><strong>Reports:</strong> a full balance sheet and complete investing/financing accounting are not established by the inspected report views. Dashboard Sales/Revenue reconciliation, cash-flow completeness and interactive drill-downs still need the existing project checks. Do not label the current statements independently audited or IFRS-certified.</li>
<li><strong>Access and release:</strong> verify plan benefits, protected offline access, account deletion, slow-connection login/verification and native subscription purchase/restore on the final Android build. The existence of source code or a completed Console form is not proof that the user journey passes.</li>
<li><strong>Store launch:</strong> the supplied Google Play dashboard from 6 October 2026 shows two setup items unfinished, zero opted-in testers and production access not yet available. Complete listing/pricing, publish a qualifying closed test, keep at least 12 testers opted in continuously for 14 days, then apply for production access. This is a dated Console snapshot, not an automatic live status check.</li>
</ul></section>
<section><h2>What was checked</h2><p>The example is validated against current mobile revenue, VAT, inventory, P&L, debt and cash-flow functions. Native and web report code, credit mutation rules and documented project accounting decisions informed the workflow. Support-service integration and production readiness require separate end-to-end verification.</p>
<details><summary>Source references for future updates</summary><ul>${sourcePaths.map(p => `<li><code>${escape(p)}</code></li>`).join("")}</ul></details></section>
<footer>ProfitNaija · Explanatory workflow · No real customer data, prices, transaction IDs or credentials are used in the example. No website, mobile app, backend or billing configuration was changed to create this guide.</footer>
</main></body></html>`;
await writeFile(new URL("./accounting-workflow.svg", import.meta.url), svg);
await writeFile(new URL("./accounting-workflow.html", import.meta.url), html);
console.log("Generated accounting-workflow.svg and accounting-workflow.html");
