import { ActionSheetIOS, Alert, Platform } from 'react-native';
import type { FundingAlternative } from '@/lib/utils/moneyAccounts';

export function isInsufficientFundsError(error: unknown): error is Error {
  const message = error instanceof Error ? error.message : String((error as any)?.message ?? '');
  return message.includes('Insufficient funds:');
}

export function showInsufficientFundsPrompt(
  error: unknown,
  onBorrow: () => void,
  alternatives: FundingAlternative[] = [],
  onSelectAlternative?: (alternative: FundingAlternative) => void,
  onAddMoney?: (account: 'cash' | 'bank') => void,
): boolean {
  if (!isInsufficientFundsError(error)) return false;
  const message = error.message.replace(/^.*?Insufficient funds:\s*/i, '');
  const suggestion = alternatives[0];
  const alternativeName = suggestion
    ? suggestion.account === 'cash' ? 'Cash' : suggestion.bankAccountName ?? 'Bank'
    : '';
  const available = suggestion
    ? ` · ₦${suggestion.available.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} available`
    : '';
  const addMoney = () => Alert.alert(
    'Add money',
    'Choose where to record the owner contribution.',
    [
      { text: 'Cash', onPress: () => onAddMoney?.('cash') },
      { text: 'Bank', onPress: () => onAddMoney?.('bank') },
      { text: 'Cancel', style: 'cancel' },
    ],
  );
  const detail = `This transaction cannot be saved. ${message}${suggestion ? `\n\nTry another saved account first: ${alternativeName}${available}. You can review the account and save manually.` : ''}`;
  if (suggestion && Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions({
      title: 'Insufficient funds',
      message: detail,
      options: [`Use ${alternativeName}`, 'Borrow money to complete the transaction', 'Add money', 'Close'],
      cancelButtonIndex: 3,
    }, index => {
      if (index === 0) onSelectAlternative?.(suggestion);
      else if (index === 1) onBorrow();
      else if (index === 2) addMoney();
    });
  } else {
    const buttons = suggestion
      ? [
          { text: `Use ${alternativeName}`, onPress: () => onSelectAlternative?.(suggestion) },
          { text: 'Borrow money to complete the transaction', onPress: onBorrow },
          { text: 'Add money', onPress: addMoney },
        ]
      : [
          { text: 'Borrow money', onPress: onBorrow },
          { text: 'Add money', onPress: addMoney },
          { text: 'Close', style: 'cancel' as const },
        ];
    Alert.alert('Insufficient funds', detail, buttons, { cancelable: true });
  }
  return true;
}
