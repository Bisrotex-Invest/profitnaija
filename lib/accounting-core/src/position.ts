import { cents, type OpeningBalances } from './index.ts';
import { financeRecords, assetCarrying, dayAfter, taxPosition, type FinanceRecord } from './finance.ts';
export function closingSupport(entries: Array<{ id:string;type:string;date:string;amount:number;category?:string;ledgerStatus?:string;finance?:FinanceRecord;purchaseVAT?:number;withholdingTax?:number }>,
  opening:{date:string;openingBalances?:OpeningBalances},cutoff:string,profitAfterRecordedTax:number,salesVAT:number) {
  const b=opening.openingBalances!;
  const records=financeRecords(entries);
  const assets=records.filter(r=>r.kind==='asset');
  const sources=new Set(assets.map(a=>a.sourceEntryId).filter(Boolean));
  const historicalCarrying=assets.reduce((sum,a)=>sum+assetCarrying(a,opening.date),0);
  const later=entries.filter(e=>e.ledgerStatus!=='void'&&e.date>opening.date&&e.date<=cutoff);
  const unregistered=later.some(e=>e.type==='expense'&&e.category?.toLowerCase()==='equipment'&&!sources.has(e.id));
  const staleSources=assets.some(a=>a.sourceEntryId&&!entries.some(e=>e.id===a.sourceEntryId&&e.ledgerStatus!=='void'&&e.type==='expense'&&e.category?.toLowerCase()==='equipment'&&e.date===a.date&&cents(e.amount)===cents(a.cost)));
  const manualDep=later.some(e=>e.type==='expense'&&e.category?.toLowerCase()==='depreciation');
  const assetsSupported=cents(historicalCarrying)===cents(b.fixedAssets)&&!unregistered&&!manualDep&&!staleSources;
  const taxes=taxPosition(records,dayAfter(opening.date),cutoff,{vat:b.vatLiability,wht:b.whtLiability,income_tax:b.incomeTaxLiability},
    salesVAT,later.filter(e=>['purchase','credit_purchase'].includes(e.type)).reduce((sum,e)=>sum+(e.purchaseVAT??0),0),
    later.filter(e=>['purchase','credit_purchase'].includes(e.type)).reduce((sum,e)=>sum+(e.withholdingTax??0),0));
  return {profit:profitAfterRecordedTax,vat:taxes.vat,wht:taxes.wht,incomeTax:taxes.income_tax,
    fixedAssets:assetsSupported?Math.round(assets.reduce((sum,a)=>sum+assetCarrying(a,cutoff),0)*100)/100:null,assetsSupported};
}
