import { request } from './equityLedgerApi';
import type { AccountingRecord, FinanceRecord } from '@workspace/accounting-core';
export type SavedFinance = AccountingRecord & { finance: FinanceRecord };
export const getFinancialRecords = () => request<{records: SavedFinance[]}>('/financial-records');
export const saveFinancialRecord = (id:string, expectedRevision:number, record:FinanceRecord) =>
  request<{entry:SavedFinance}>('/financial-records','PUT',{id,expectedRevision,record});
export const voidFinancialRecord = (id:string,expectedRevision:number,reason:string) =>
  request('/financial-records','DELETE',{id,expectedRevision,reason});
export const extractStatement = (fileName:string,contentBase64:string) =>
  request<{table:string[][];warnings:string[]}>('/statement-import','POST',{fileName,contentBase64});
