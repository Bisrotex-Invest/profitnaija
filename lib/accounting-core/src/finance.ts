import { bankAccountDisplayName, bankAccountKey, cents, validAccountingDate } from './index.ts';
import { validateWorkingRecord, workingBalance, workingMoney, workingRecords, type WorkingCapitalRecord, type WorkingEntry } from './workingCapital.ts';

export type FinanceRecord = AssetRecord | TaxRecord | StatementRecord | WorkingCapitalRecord | BankTransferRecord;
export interface FinanceBase { kind: string; reference: string; notes: string; bankAccountName?: string }
export interface AssetRecord extends FinanceBase {
  kind: 'asset'; name: string; cost: number; residualValue: number;
  usefulLifeMonths: number; date: string; depreciationStart: string;
  paymentMode: 'cash' | 'bank' | 'non_cash'; sourceEntryId: string;
  disposalDate?: string; disposalProceeds?: number; disposalAccount?: 'cash' | 'bank';
  disposalBankAccountName?: string;
}
export interface TaxRecord extends FinanceBase {
  kind: 'tax'; taxType: 'vat' | 'wht' | 'income_tax';
  action: 'charge' | 'payment' | 'credit'; amount: number; date: string;
  paymentMode: 'cash' | 'bank' | 'non_cash'; confirmed: boolean;
  sourceEntryId?: string;
}
export interface StatementRow { id: string; date: string; description: string; amount: number; reference: string; matchedEntryId?: string }
export interface StatementRecord extends FinanceBase {
  kind: 'statement'; bankName: string; accountLabel: string; startDate: string; endDate: string;
  openingBalance: number; closingBalance: number; rows: StatementRow[];
  outstandingEntryIds: string[]; completeBankCoverage: boolean;
}
export interface BankTransferRecord extends FinanceBase {
  kind: 'bank_transfer';
  fromAccount: 'cash' | 'bank';
  toAccount: 'cash' | 'bank';
  fromBankAccountName?: string;
  toBankAccountName?: string;
  amount: number;
  date: string;
}

function parseStatementMoneyCell(value: string): number | null {
  let text = value.trim().replace(/\s+/g, '');
  const parenthesized = /^\(.*\)$/.test(text);
  if (parenthesized) text = text.slice(1, -1);
  let sign = parenthesized ? -1 : 1;
  if (/^[+-]/.test(text)) {
    if (text[0] === '-') sign *= -1;
    text = text.slice(1);
  }
  text = text.replace(/^(?:NGN|₦|N)/i, '');
  if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/.test(text)) return null;
  const amount = Number(text.replace(/,/g, ''));
  return Number.isFinite(amount) ? sign * amount : null;
}

/** Extract only an unambiguous, explicitly labelled closing balance. */
export function extractStatementClosingBalance(table: string[][]): number | null {
  const labeled = table.filter(row =>
    /\b(?:closing|ending|final)\s+(?:available\s+)?balance\b|\bbalance\s+(?:at|as at|as of)\s+(?:the\s+)?(?:end|period end)\b/i.test(row.join(' ')),
  );
  if (labeled.length === 0) return null;
  const values: number[] = [];
  for (const row of labeled) {
    let candidates = row.map(parseStatementMoneyCell).filter((value): value is number => value !== null);
    if (candidates.length === 0) {
      const marked = row.join(' ').match(/(?:NGN|₦|N)\s*[+-]?\s*\(?\s*\d[\d,]*(?:\.\d{1,2})?\s*\)?/gi) ?? [];
      candidates = marked.map(parseStatementMoneyCell).filter((value): value is number => value !== null);
    }
    if (candidates.length !== 1) return null;
    values.push(candidates[0]!);
  }
  const unique = [...new Set(values.map(value => Math.round(value * 100)))];
  return unique.length === 1 ? unique[0]! / 100 : null;
}

export interface FinanceEntry {
  id: string; type: string; date: string; amount: number; category?: string;
  createdAt?: number; ledgerStatus?: string; finance?: FinanceRecord;
  paymentMode?: string; [key: string]: unknown;
}
export function money(n: number) { return cents(n) / 100; }
export function dayBefore(date: string) {
  const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
export function dayAfter(date: string) {
  const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function amount(value: unknown, signed = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12 ||
    (!signed && value < 0) || Math.abs(value * 100 - cents(value)) > .001) throw new Error('Enter finite amounts with at most two decimals.');
}
function str(value: unknown, max = 300, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error('Enter the required text within its length limit.');
}
function date(value: unknown) { if (!validAccountingDate(value)) throw new Error('Enter a real date in YYYY-MM-DD format.'); }
export function validateFinanceRecord(record: FinanceRecord): void {
  if (!record || !['asset', 'tax', 'statement', 'working_capital', 'bank_transfer'].includes(record.kind)) throw new Error('Choose a supported financial record.');
  str(record.reference, 200, true); str(record.notes, 1000);
  if (record.kind === 'working_capital') {
    validateWorkingRecord(record);
    if (record.paymentMode === 'bank') str(record.bankAccountName, 120, true);
  } else if (record.kind === 'asset') {
    str(record.name, 120, true); amount(record.cost); amount(record.residualValue);
    if (record.cost <= 0 || record.residualValue > record.cost) throw new Error('Asset cost must be positive and residual value cannot exceed cost.');
    if (!Number.isSafeInteger(record.usefulLifeMonths) || record.usefulLifeMonths < 1 || record.usefulLifeMonths > 1200) throw new Error('Useful life must be 1–1200 months.');
    date(record.date); date(record.depreciationStart);
    if (record.depreciationStart < record.date) throw new Error('Depreciation cannot start before acquisition.');
    if (!['cash', 'bank', 'non_cash'].includes(record.paymentMode)) throw new Error('Choose the asset payment account.');
    str(record.sourceEntryId, 160);
    if (record.sourceEntryId && record.paymentMode !== 'non_cash') throw new Error('Linked historical purchases must not post a second payment.');
    if (record.paymentMode === 'bank' && !record.sourceEntryId) str(record.bankAccountName, 120, true);
    if (record.disposalDate) {
      date(record.disposalDate); amount(record.disposalProceeds);
      if (record.disposalDate < record.date || !['cash', 'bank'].includes(record.disposalAccount ?? '')) throw new Error('Choose a valid disposal date and receipt account.');
      if (record.disposalAccount === 'bank') str(record.disposalBankAccountName, 120, true);
    }
  } else if (record.kind === 'tax') {
    date(record.date); amount(record.amount);
    if (record.amount <= 0 || !['vat','wht','income_tax'].includes(record.taxType) ||
      !['charge','payment','credit'].includes(record.action) || record.confirmed !== true) throw new Error('Confirm a supported positive tax charge, payment or credit against records.');
    if(record.sourceEntryId){str(record.sourceEntryId,160,true);if(record.action!=='payment'||record.paymentMode!=='non_cash')throw new Error('A linked existing tax payment must not post another Cash/Bank payment.');}
    else if (record.action === 'payment' ? !['cash','bank'].includes(record.paymentMode) : record.paymentMode !== 'non_cash') throw new Error('Only tax payments move Cash/Bank.');
    if (record.action === 'payment' && record.paymentMode === 'bank' && !record.sourceEntryId) str(record.bankAccountName, 120, true);
  } else if (record.kind === 'bank_transfer') {
    date(record.date); amount(record.amount);
    if (record.amount <= 0 || !['cash','bank'].includes(record.fromAccount) || !['cash','bank'].includes(record.toAccount) ||
      (record.fromAccount === 'cash' && record.toAccount === 'cash')) throw new Error('Choose two different payment accounts and a positive transfer amount.');
    if (record.fromAccount === 'bank') str(record.fromBankAccountName, 120, true);
    if (record.toAccount === 'bank') str(record.toBankAccountName, 120, true);
    if (record.fromAccount === 'bank' && record.toAccount === 'bank' &&
      record.fromBankAccountName?.trim().toLocaleLowerCase() === record.toBankAccountName?.trim().toLocaleLowerCase())
      throw new Error('Choose two different bank accounts for this transfer.');
  } else {
    str(record.bankName, 120, true); str(record.accountLabel, 120, true);
    date(record.startDate); date(record.endDate); amount(record.openingBalance, true); amount(record.closingBalance, true);
    if (record.startDate > record.endDate || !Array.isArray(record.rows) || record.rows.length > 1500) throw new Error('Choose an ordered statement period containing at most 1500 reviewed rows; a no-activity statement must have equal opening and closing balances.');
    const ids = new Set<string>();
    for (const row of record.rows) {
      str(row.id, 100, true); date(row.date); str(row.description, 300); str(row.reference, 200); amount(row.amount, true);
      if (row.amount === 0 || row.date < record.startDate || row.date > record.endDate || ids.has(row.id)) throw new Error('Statement rows must be unique, non-zero and within the period.');
      ids.add(row.id); if (row.matchedEntryId) str(row.matchedEntryId, 180, true);
    }
    if (!Array.isArray(record.outstandingEntryIds) || record.outstandingEntryIds.length > 1500 ||
      new Set(record.outstandingEntryIds).size !== record.outstandingEntryIds.length ||
      record.outstandingEntryIds.some(id => typeof id !== 'string' || !id || id.length > 180) ||
      typeof record.completeBankCoverage !== 'boolean') throw new Error('Review outstanding book entries and bank coverage.');
    if (cents(record.openingBalance) + record.rows.reduce((sum, row) => sum + cents(row.amount), 0) !== cents(record.closingBalance)) throw new Error('Statement opening plus signed transactions must equal statement closing. Review missing/duplicate rows.');
  }
  const bytes=Array.from(JSON.stringify(record)).reduce((n,c)=>n+(c.codePointAt(0)!>0xffff?4:c.charCodeAt(0)>0x7ff?3:c.charCodeAt(0)>0x7f?2:1),0);
  if (bytes > 650000) throw new Error('Split this statement into smaller periods.');
}
export function financeRecords(entries: { finance?: FinanceRecord; ledgerStatus?: string }[]) {
  return entries.filter(e => e.finance && e.ledgerStatus !== 'void').map(e => e.finance!);
}
/** Monthly straight line, daily prorating within calendar months; capped at cost less residual. */
export function accumulatedDepreciation(asset: AssetRecord, cutoff: string): number {
  const end = asset.disposalDate && asset.disposalDate < cutoff ? asset.disposalDate : cutoff;
  if (end < asset.depreciationStart) return 0;
  const first = new Date(`${asset.depreciationStart}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  const startIndex = first.getUTCFullYear()*12 + first.getUTCMonth();
  const endIndex = last.getUTCFullYear()*12 + last.getUTCMonth();
  const daysIn = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth()+1, 0)).getUTCDate();
  const months = startIndex === endIndex ? (last.getUTCDate()-first.getUTCDate()+1)/daysIn(first)
    : (daysIn(first)-first.getUTCDate()+1)/daysIn(first) + Math.max(0,endIndex-startIndex-1) + last.getUTCDate()/daysIn(last);
  return money(Math.min(asset.cost-asset.residualValue, (asset.cost-asset.residualValue)*months/asset.usefulLifeMonths));
}
export function assetCarrying(asset: AssetRecord, cutoff: string) {
  return cutoff < asset.date || (asset.disposalDate && asset.disposalDate <= cutoff) ? 0 : money(asset.cost - accumulatedDepreciation(asset, cutoff));
}
export function leaseRightOfUseAsset(record: WorkingCapitalRecord): AssetRecord | null {
  if (record.account !== 'lease' || record.action !== 'increase' || !record.leaseTermMonths) return null;
  return {
    kind: 'asset', name: `Right-of-use asset · ${record.partyName}`, cost: record.amount, residualValue: 0,
    usefulLifeMonths: record.leaseTermMonths, date: record.date, depreciationStart: record.date,
    paymentMode: 'non_cash', sourceEntryId: '', reference: record.reference, notes: record.notes,
  };
}
/** Carrying amount of recognized lease right-of-use assets at a reporting date. */
export function leaseAssetCarrying(entries: WorkingEntry[], cutoff: string): number {
  return money(workingRecords(entries).reduce((sum, { id, record }) => {
    const asset = leaseRightOfUseAsset(record);
    if (!asset || record.date > cutoff) return sum;
    return sum + assetCarrying(asset, cutoff);
  }, 0));
}
function leaseDepreciationTo(entries: WorkingEntry[], cutoff: string): number {
  return workingRecords(entries).reduce((sum, { record }) => {
    const asset = leaseRightOfUseAsset(record);
    return sum + (asset && record.date <= cutoff ? accumulatedDepreciation(asset, cutoff) : 0);
  }, 0);
}
export function financialPeriod(entries: { finance?: FinanceRecord; ledgerStatus?: string }[], start: string, end: string) {
  const records = financeRecords(entries);
  let depreciation = 0, disposalProfit = 0, taxExpense = 0, incomeTaxExpense = 0;
  for (const record of records) {
    if (record.kind === 'asset') {
      depreciation += accumulatedDepreciation(record,end)-accumulatedDepreciation(record,dayBefore(start));
      if (record.disposalDate && record.disposalDate >= start && record.disposalDate <= end)
        disposalProfit += (record.disposalProceeds ?? 0) - (record.cost - accumulatedDepreciation(record,record.disposalDate));
    } else if (record.kind === 'tax' && record.date >= start && record.date <= end && record.action !== 'payment') {
      const value = record.action === 'charge' ? record.amount : -record.amount;
      if(record.taxType==='income_tax') incomeTaxExpense+=value; else taxExpense+=value;
    }
  }
  const workingEntries = entries as WorkingEntry[];
  depreciation += leaseDepreciationTo(workingEntries, end) - leaseDepreciationTo(workingEntries, dayBefore(start));
  return { depreciation: money(depreciation), disposalProfit: money(disposalProfit), taxExpense: money(taxExpense), incomeTaxExpense:money(incomeTaxExpense) };
}
export function financialMoneyMovements(entry: { id: string; finance?: FinanceRecord; ledgerStatus?: string }) {
  const r = entry.finance; const result: { id: string; date: string; account: 'cash'|'bank'; amount: number; bankAccountName?: string }[] = [];
  if (!r || entry.ledgerStatus === 'void') return result;
  if (r.kind === 'bank_transfer') {
    return [
      { id: `${entry.id}:transfer-out`, date: r.date, account: r.fromAccount, amount: -r.amount, bankAccountName: r.fromAccount === 'bank' ? r.fromBankAccountName : undefined },
      { id: `${entry.id}:transfer-in`, date: r.date, account: r.toAccount, amount: r.amount, bankAccountName: r.toAccount === 'bank' ? r.toBankAccountName : undefined },
    ];
  }
  if (r.kind === 'working_capital') {
    if (r.paymentMode !== 'non_cash') result.push({ id:entry.id, date:r.date, account:r.paymentMode, amount:workingMoney(r), bankAccountName:r.paymentMode === 'bank' ? r.bankAccountName : undefined });
  } else if (r.kind === 'asset') {
    if (!r.sourceEntryId && r.paymentMode !== 'non_cash') result.push({ id: entry.id, date:r.date, account:r.paymentMode, amount:-r.cost, bankAccountName:r.paymentMode === 'bank' ? r.bankAccountName : undefined });
    if (r.disposalDate) result.push({ id:`${entry.id}:disposal`, date:r.disposalDate, account:r.disposalAccount!, amount:r.disposalProceeds!, bankAccountName:r.disposalAccount === 'bank' ? r.disposalBankAccountName : undefined });
  } else if (r.kind === 'tax' && r.action === 'payment' && !r.sourceEntryId) result.push({ id:entry.id, date:r.date, account:r.paymentMode as 'cash'|'bank', amount:-r.amount, bankAccountName:r.paymentMode === 'bank' ? r.bankAccountName : undefined });
  return result;
}
export function linkedTaxSourceIds(entries:Array<{id:string;type?:string;date?:string;amount?:number;finance?:FinanceRecord;ledgerStatus?:string}>) {
  return new Set(entries.flatMap(e=>{
    const r=e.finance;
    if(e.ledgerStatus==='void'||r?.kind!=='tax'||r.action!=='payment'||!r.sourceEntryId)return [];
    const source=entries.find(s=>s.id===r.sourceEntryId&&s.type==='expense'&&s.ledgerStatus!=='void'&&s.date===r.date&&cents(s.amount??NaN)===cents(r.amount));
    return source?[r.sourceEntryId]:[];
  }));
}
export function financialCashFlow(entries:Array<{id:string;type?:string;date?:string;amount?:number;finance?:FinanceRecord;ledgerStatus?:string}>,start:string,end:string,openingDate?:string) {
  let taxPayments=0,assetAcquisitions=0,assetDisposalProceeds=0;
  const sources=linkedTaxSourceIds(entries);
  for(const e of entries){
    const r=e.finance;
    if(e.ledgerStatus!=='void'&&r?.kind==='tax'&&r.action==='payment'&&r.sourceEntryId&&sources.has(r.sourceEntryId)&&r.date>=start&&r.date<=end&&(!openingDate||r.date>openingDate))taxPayments+=r.amount;
  }
  for(const entry of entries)for(const m of financialMoneyMovements(entry))if(m.date>=start&&m.date<=end&&(!openingDate||m.date>openingDate)){
    if(entry.finance?.kind==='working_capital')continue;
    else if(entry.finance?.kind==='tax')taxPayments-=m.amount;
    else if(m.id.endsWith(':disposal'))assetDisposalProceeds+=m.amount;
    else assetAcquisitions-=m.amount;
  }
  return {taxPayments:money(taxPayments),assetAcquisitions:money(assetAcquisitions),assetDisposalProceeds:money(assetDisposalProceeds)};
}
export function taxPosition(records: FinanceRecord[], start: string, end: string, opening: {vat:number;wht:number;income_tax:number}, salesVAT: number, inputVAT: number, withheld: number) {
  const result = {vat: opening.vat + salesVAT-inputVAT, wht:opening.wht+withheld, income_tax:opening.income_tax};
  for (const r of records) if(r.kind==='tax' && r.date>=start && r.date<=end)
    result[r.taxType] += r.action==='charge'?r.amount:-r.amount;
  return {vat:money(result.vat),wht:money(result.wht),income_tax:money(result.income_tax)};
}
export interface BankMovement { id: string; date: string; amount: number; description: string; bankAccountName?: string }
export function reconcileStatements(allStatements: StatementRecord[], allMovements: BankMovement[], bookClosing: number, accountName?: string, unassignedOpening = 0) {
  const statementKey = (statement: StatementRecord) => bankAccountKey(bankAccountDisplayName(statement.bankName, statement.accountLabel));
  const accountKey = accountName ? bankAccountKey(accountName) : undefined;
  const statements = accountKey ? allStatements.filter(s => statementKey(s) === accountKey) : allStatements;
  const movements = accountKey ? allMovements.filter(m => bankAccountKey(m.bankAccountName ?? '') === accountKey) : allMovements;
  const matched = new Set<string>(), outstanding = new Set<string>();
  let stale = 0, unmatchedRows = 0, invalidStatements=0;
  const accounts=new Set<string>();
  for (const statement of statements) {
    try{validateFinanceRecord(statement);}catch{invalidStatements++;}
    const account=JSON.stringify([statement.bankName.trim().toLowerCase(),statement.accountLabel.trim().toLowerCase()]);
    if(accounts.has(account))invalidStatements++;accounts.add(account);
    for (const row of statement.rows) {
      const book = movements.find(m => m.id===row.matchedEntryId);
      if (!row.matchedEntryId) unmatchedRows++;
      else if (!book || bankAccountKey(book.bankAccountName ?? '') !== statementKey(statement) ||
        cents(book.amount)!==cents(row.amount) || book.date>statement.endDate || matched.has(book.id)) stale++;
      else matched.add(book.id);
    }
    for(const id of statement.outstandingEntryIds) outstanding.add(id);
  }
  const start = statements[0]?.startDate ?? ''; const end = statements[0]?.endDate ?? '';
  const unmatchedBooks = movements.filter(m=>m.date>=start && m.date<=end && !matched.has(m.id) && !outstanding.has(m.id));
  const unassignedBankMovements = allMovements.filter(m => m.date >= start && m.date <= end && !m.bankAccountName?.trim()).length;
  const outstandingAmount = movements.filter(m=>outstanding.has(m.id) && !matched.has(m.id) && m.date<=end).reduce((sum,m)=>sum+cents(m.amount),0)/100;
  const invalidOutstanding = [...outstanding].filter(id => {
    const movement = movements.find(m => m.id === id);
    return !movement || movement.date > end || matched.has(id) ||
      (statements.length > 0 && !statements.some(s => bankAccountKey(movement.bankAccountName ?? '') === statementKey(s)));
  }).length;
  const statementClosing = money(statements.reduce((sum,s)=>sum+s.closingBalance,0));
  const variance = money(bookClosing-statementClosing-outstandingAmount);
  return { statementClosing,bookClosing,outstandingAmount,variance,unmatchedRows,unmatchedBooks:unmatchedBooks.length,unassignedBankMovements,unassignedOpening,stale:stale+invalidOutstanding,
    invalidStatements,
    reconciled:Number.isFinite(bookClosing) && invalidStatements===0 && !!statements.length && statements.every(s=>s.completeBankCoverage && s.startDate===start && s.endDate===end) &&
       unmatchedRows===0 && unmatchedBooks.length===0 && unassignedBankMovements===0 && cents(unassignedOpening)===0 && stale+invalidOutstanding===0 && variance===0 };
}
