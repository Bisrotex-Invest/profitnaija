import assert from 'node:assert/strict';
import test from 'node:test';
import type { Entry } from '@/context/EntriesContext';
import type { UserProfile } from '@/context/ProfileContext';
import { buildInvoiceHtml } from '@/lib/utils/invoice-html';

const profile: UserProfile = {
  fullName: '', gender: '', phone: '', email: '', homeAddress: '',
  photoUri: '', businessName: 'Test Shop', businessAddress: '',
  businessPhone: '', natureOfBusiness: '', incomeTaxRate: '',
  termsAccepted: false,
  accountingYearEnd: '12-31', accountingYearConfirmed: false,
};

function makeSale(type: 'sale' | 'credit_sale'): Entry {
  return {
    id: 'invoice-sale', type, amount: 215, category: '', notes: '',
    date: '2025-01-10', createdAt: 0, itemName: 'Rice',
    partyName: 'Customer', unitsSold: 2, unitSalesPrice: 100, vatPaid: 15,
  };
}

test('customer invoices show base sale, VAT and gross customer total', () => {
  const html = buildInvoiceHtml(makeSale('sale'), profile);

  assert.match(html, /Unit selling price/);
  assert.match(html, /₦215\.00/);
  assert.match(html, /Invoice Total/);
  assert.match(html, /Sales amount \(excl\. VAT\)/);
  assert.match(html, /VAT \(7\.5%\)/);
  assert.doesNotMatch(html, /<span>Paid<\/span>/);
});

test('credit invoices show paid and balance against gross customer total', () => {
  const html = buildInvoiceHtml(makeSale('credit_sale'), profile, 80);

  assert.match(html, /Invoice Total<\/span><strong>₦215\.00/);
  assert.match(html, /Paid<\/span><strong>₦80\.00/);
  assert.match(html, /Balance Due<\/span><strong class="balance-value">₦135\.00/);
  assert.match(html, /Sales amount \(excl\. VAT\)/);
  assert.match(html, /VAT \(7\.5%\)/);
});

test('VAT-exclusive invoice adds VAT once and preserves customer debt', () => {
  const html = buildInvoiceHtml({ ...makeSale('credit_sale'), vatExclusive: true, unitSalesPrice: 100, amount: 215 }, profile, 80);
  assert.match(html, /Sales amount \(excl\. VAT\)<\/span><strong>₦200\.00/);
  assert.match(html, /VAT \(7\.5%\)<\/span><strong>₦15\.00/);
  assert.match(html, /Invoice Total<\/span><strong>₦215\.00/);
  assert.match(html, /Balance Due<\/span><strong class="balance-value">₦135\.00/);
});