import { validAccountingDate } from './index.ts';
import { money, type StatementRow } from './finance.ts';
export function parseCSV(text: string): string[][] {
  const sample=text.split(/\r?\n/).find(line=>line.trim())??'';
  const delimiter=sample.split('\t').length>sample.split(',').length?'\t':sample.split(';').length>sample.split(',').length?';':',';
  const rows:string[][]=[]; let row:string[]=[], cell='', quoted=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(c==='"') { if(quoted && text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted; }
    else if(!quoted && c===delimiter){row.push(cell.trim());cell='';}
    else if(!quoted && (c==='\n'||c==='\r')) { if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell.trim());if(row.some(Boolean))rows.push(row);row=[];cell=''; }
    else cell+=c;
  }
  if(quoted)throw new Error('CSV has an unclosed quoted cell.');
  row.push(cell.trim());if(row.some(Boolean))rows.push(row);
  return rows;
}
export function parseStatementAmount(value: string): number {
  const text=value.trim().replace(/[₦,\s]/g,'').replace(/^NGN/i,'');
  if(!text||text==='-')return 0;
  const debit=/DR$/i.test(text)||/^\(.*\)$/.test(text);
  const raw=text.replace(/(CR|DR)$/i,'').replace(/[()]/g,'');
  if(!/^[+-]?\d+(\.\d{1,2})?$/.test(raw))throw new Error(`Review amount: ${value.slice(0,40)}`);
  return money(debit?-Math.abs(Number(raw)):Number(raw));
}
export function parseStatementDate(value:string, format:'DMY'|'MDY'='DMY') {
  const text=value.trim();
  if(validAccountingDate(text))return text;
  const numeric=/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2}|\d{4})$/.exec(text);
  let result='';
  if(numeric) {
    const year=numeric[3]!.length===2?`20${numeric[3]}`:numeric[3]!;
    const day=format==='DMY'?numeric[1]:numeric[2], month=format==='DMY'?numeric[2]:numeric[1];
    result=`${year}-${month!.padStart(2,'0')}-${day!.padStart(2,'0')}`;
  } else {
    const named=/^(\d{1,2})[\s/-]+([A-Za-z]{3,9})[\s/,-]+(\d{4})$/.exec(text);
    const month=named?['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(named[2]!.slice(0,3).toLowerCase())+1:0;
    if(named&&month)result=`${named[3]}-${String(month).padStart(2,'0')}-${named[1]!.padStart(2,'0')}`;
  }
  if(!validAccountingDate(result))throw new Error(`Review date: ${value.slice(0,40)}`);
  return result;
}
export interface StatementColumns { date:number;description:number;amount?:number;debit?:number;credit?:number;reference?:number; dateFormat?:'DMY'|'MDY' }
export function mapStatementRows(table:string[][], columns:StatementColumns): {rows:StatementRow[];errors:string[]} {
  const rows:StatementRow[]=[],errors:string[]=[];
  table.forEach((cells,index)=>{
    try {
      const date=parseStatementDate(cells[columns.date]??'',columns.dateFormat);
      const amount=columns.amount!==undefined?parseStatementAmount(cells[columns.amount]??''):
        parseStatementAmount(cells[columns.credit??-1]??'')-Math.abs(parseStatementAmount(cells[columns.debit??-1]??''));
      if(!amount)throw new Error('Zero amount: check the mapped columns or exclude the non-transaction row.');
      rows.push({id:`row_${index+1}`,date,amount:money(amount),description:(cells[columns.description]??'').slice(0,300),reference:(cells[columns.reference??-1]??'').slice(0,200)});
    }catch(error){errors.push(`Row ${index+1}: ${(error as Error).message}`);}
  });
  return {rows,errors};
}
