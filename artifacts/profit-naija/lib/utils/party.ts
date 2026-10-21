import type { Entry } from '@/context/EntriesContext';

export function normalizePartyName(value?: string): string {
  return (value ?? '').trim().toLocaleLowerCase();
}

/** Canonical Nigerian local/mobile representation for matching only. */
export function normalizeNigerianPhone(value?: string): string {
  const digits = (value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('234')) {
    const local = digits.slice(3).replace(/^0+/, '');
    return local ? `0${local}` : '';
  }
  const local = digits.replace(/^0+/, '');
  return local ? `0${local}` : '';
}

export function duplicatePartyEntry(
  entries: Entry[],
  kind: 'customer' | 'supplier',
  name: string,
  phone: string,
  excludeId?: string,
): Entry | undefined {
  const type = kind === 'customer' ? 'credit_sale' : 'credit_purchase';
  const normalizedPhone = normalizeNigerianPhone(phone);
  const normalizedName = normalizePartyName(name);
  return entries.find(entry =>
    (entry.type === type || (kind === 'supplier' && entry.type === 'expense' && entry.paymentMode === 'credit')) &&
    entry.id !== excludeId &&
    normalizeNigerianPhone(entry.partyPhone) === normalizedPhone &&
    normalizePartyName(entry.partyName) !== normalizedName,
  );
}