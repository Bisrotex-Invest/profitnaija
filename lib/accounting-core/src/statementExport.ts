/** Presentation only: preserves supplied amounts and never recalculates them. */
export interface StatementExportRow {
  label: string;
  value: number;
  valueStr: string;
  total?: boolean;
  grandTotal?: boolean;
  summaryRow?: boolean;
  isSub?: boolean;
}

export interface StatementDocument {
  businessName: string;
  title: string;
  periodLabel: string;
  rows: StatementExportRow[];
  note?: string;
}

export interface StatementTransaction {
  id: string;
  date: string;
  type: string;
  amount: number;
  itemName?: string;
  category?: string;
  partyName?: string;
  paymentMode?: string;
  notes?: string;
  reference?: string;
  unitsSold?: number;
  unitsPurchased?: number;
  returns?: number;
}

/** Append the actual source ledger without changing the statement's totals. */
export function statementTransactionRows(
  entries: StatementTransaction[],
  amountFor: (entry: StatementTransaction) => string,
): StatementExportRow[] {
  return [
    { label: 'Transaction details', value: 0, valueStr: '', summaryRow: true },
    ...(entries.length ? [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)).map(entry => {
      const quantity = entry.unitsSold ?? entry.unitsPurchased ?? entry.returns;
      const label = [
        entry.date, entry.type.replace(/_/g, ' '), entry.itemName || entry.category,
        entry.partyName, quantity !== undefined ? `${quantity} units` : '',
        entry.paymentMode ? `Payment: ${entry.paymentMode.replace(/_/g, ' ')}` : '',
        entry.reference ? `Ref: ${entry.reference}` : `ID: ${entry.id}`,
        entry.notes,
      ].filter(Boolean).join(' | ');
      return { label, value: entry.amount, valueStr: amountFor(entry) };
    }) : [{ label: 'No transactions in the selected period.', value: 0, valueStr: '', summaryRow: true }]),
  ];
}

export function statementRowsFromLines(lines: string[]): StatementExportRow[] {
  const rows = lines.filter(line => line.trim()).map(line => {
    const split = line.lastIndexOf(': ');
    const label = split < 0 ? line : line.slice(0, split);
    const valueStr = split < 0 ? '' : line.slice(split + 2).trim();
    return { label, value: 0, valueStr, summaryRow: !valueStr } as StatementExportRow;
  });
  for (let index = rows.length - 1; index >= 0; index--) {
    if (rows[index].valueStr) {
      rows[index].grandTotal = true;
      break;
    }
  }
  return rows;
}

function escape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** The same printable statement table is used by the web and native apps. */
export function statementToHTML(model: StatementDocument): string {
  const rows = model.rows.filter(row => row.summaryRow || row.valueStr !== '');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escape(model.businessName)} — ${escape(model.title)}</title>
<style>
@page{size:A4;margin:18mm}
*{box-sizing:border-box}
body{font-family:Arial,Helvetica,sans-serif;color:#171717;margin:0 auto;padding:32px;max-width:800px;font-size:14px}
h1{font-size:24px;margin:0 0 6px;overflow-wrap:anywhere}
.subtitle{font-size:13px;color:#737373;margin:0 0 28px}
table{width:100%;border-collapse:collapse;table-layout:fixed}
thead{display:table-header-group}
th{background:#555;color:#fff;text-align:left;text-transform:uppercase;font-size:12px;letter-spacing:.03em;padding:14px 16px}
th:first-child{width:70%}
th:last-child,td:last-child{text-align:right}
td{padding:13px 16px;border-bottom:1px solid #e5e5e5;overflow-wrap:anywhere;vertical-align:top}
td:last-child{font-weight:700;font-variant-numeric:tabular-nums}
tr{page-break-inside:avoid;break-inside:avoid}
.total td,.section td{background:#f8f8f8;font-weight:700;border-top:1px solid #d4d4d4}
.grand td{background:#f8f8f8;font-weight:700;border-top:2px solid #555;border-bottom:2px solid #555}
.sub td:first-child{padding-left:28px}
.note{font-size:11px;color:#737373;margin-top:18px}
@media print{body{padding:0;max-width:none}th{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>
<h1>${escape(model.businessName || 'Business')}</h1>
<p class="subtitle">${escape(model.title)}${model.periodLabel ? `${model.periodLabel.startsWith('the year ended ') ? ', for ' : ' for '}${escape(model.periodLabel.replace(/^for /, ''))}` : ''}</p>
<table><thead><tr><th>${escape(model.title)}</th><th>Amount (NGN)</th></tr></thead><tbody>
${rows.map(row => `<tr class="${row.grandTotal ? 'grand' : row.total ? 'total' : row.summaryRow ? 'section' : row.isSub ? 'sub' : ''}"><td>${escape(row.label)}</td><td>${escape(row.valueStr)}</td></tr>`).join('')}
</tbody></table>${model.note ? `<p class="note">${escape(model.note)}</p>` : ''}
</body></html>`;
}
