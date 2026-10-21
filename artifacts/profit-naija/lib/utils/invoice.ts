import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import type { Entry } from '@/context/EntriesContext';
import type { UserProfile } from '@/context/ProfileContext';
import { buildInvoiceHtml, getInvoiceNumber } from '@/lib/utils/invoice-html';

export { buildInvoiceHtml, getInvoiceGross, getInvoiceNumber } from '@/lib/utils/invoice-html';

export async function printInvoice(entry: Entry, profile: UserProfile, paidToDate = 0, returnCredits = 0): Promise<void> {
  await Print.printAsync({ html: buildInvoiceHtml(entry, profile, paidToDate, returnCredits) });
}

export async function shareInvoice(entry: Entry, profile: UserProfile, paidToDate = 0, returnCredits = 0): Promise<void> {
  if (Platform.OS === 'web') {
    throw new Error('Invoice sharing is available from the mobile app. Use Print to save or print this invoice on web.');
  }
  const { uri } = await Print.printToFileAsync({ html: buildInvoiceHtml(entry, profile, paidToDate, returnCredits) });
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
    dialogTitle: `${getInvoiceNumber(entry)} — Share invoice`,
  });
}