import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView } from 'react-native';
import { reviewReturnCredit } from '@workspace/api-client-react';
import { returnCreditAmount } from '@workspace/accounting-core';
import { useEntries } from '@/context/EntriesContext';
import { useColors } from '@/hooks/useColors';
import { getOutstandingCredits } from '@/lib/utils/formulas';
import { fmt } from '@/lib/financeUi';

export function ReturnCreditReview() {
  const colors = useColors();
  const { entries, loading, error } = useEntries();
  const [returnId, setReturnId] = useState(''), [creditId, setCreditId] = useState('');
  const [reference, setReference] = useState(''), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const returns = entries.filter(e => ['return_inward', 'return_outward'].includes(e.type) && e.ledgerStatus !== 'void');
  const selected = returns.find(e => e.id === returnId);
  const kind = selected?.type === 'return_inward' ? 'sale' : 'purchase';
  const candidates = selected ? getOutstandingCredits(entries, kind, undefined, true).filter(c =>
    !!selected.productId && c.originalEntry.ledgerStatus !== 'void'
    && c.originalEntry.type === (kind === 'sale' ? 'credit_sale' : 'credit_purchase')
    && c.originalEntry.productId === selected.productId && c.originalEntry.date <= selected.date
    && (c.remainingBalance > 0 || c.originalEntry.id === selected.returnCreditEntryId)) : [];
  const choose = (id: string) => { setReturnId(id); setCreditId(''); setReference(''); setConfirmed(false); setMessage(''); };
  const save = async () => {
    if (!selected || busy) return;
    setBusy(true); setMessage('');
    try {
      await reviewReturnCredit({ returnId: selected.id, creditEntryId: selected.returnCreditEntryId ? '' : creditId,
        expectedCreditEntryId: selected.returnCreditEntryId ?? '', expectedAmount: returnCreditAmount(selected),
        expectedDate: selected.date, reference: reference.trim(), confirmed });
      choose(''); setMessage('Return settlement saved.');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not save. Reload before retrying.'); }
    finally { setBusy(false); }
  };
  const text = { color: colors.foreground, fontFamily: 'Inter_400Regular', fontSize: 13 } as const;
  const option = (id: string, label: string, active: boolean, action: () => void) =>
    <Pressable key={id} onPress={action} disabled={busy || loading || !!error} accessibilityRole="button" accessibilityState={{ selected: active }}
      style={{ padding: 12, borderWidth: 1, borderRadius: 10, borderColor: active ? colors.primary : colors.border, marginBottom: 6 }}>
      <Text style={text}>{active ? 'Selected · ' : ''}{label}</Text>
    </Pressable>;
  return <View style={{ padding: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, borderRadius: 14, gap: 12 }} testID="return-credit-review">
    <Text style={[text, { fontFamily: 'Inter_700Bold', fontSize: 16 }]}>Return credits</Text>
    <Text style={text}>Link only when no money was refunded. Existing returns stay unchanged until reviewed.</Text>
    <Text style={text}>Choose a return</Text>
    <ScrollView style={{ maxHeight: 210 }} nestedScrollEnabled>
      {returns.length === 0 && <Text style={text}>No recorded returns.</Text>}
      {returns.map(e => option(e.id, `${e.date} · ${e.itemName || e.category} · ${fmt(returnCreditAmount(e))}${e.returnCreditEntryId ? ' · Credit linked' : ' · Money settlement'}`, returnId === e.id, () => choose(e.id)))}
    </ScrollView>
    {selected && <>
      {selected.returnCreditEntryId ? <Text style={text}>Removing the link restores the original money-settlement treatment.</Text> : <>
        <Text style={text}>Original unpaid {kind === 'sale' ? 'invoice' : 'supplier bill'}</Text>
        <ScrollView style={{ maxHeight: 210 }} nestedScrollEnabled>
          {candidates.length === 0 && <Text style={text}>No unpaid credit transaction for this product.</Text>}
          {candidates.map(c => option(c.originalEntry.id, `${c.originalEntry.date} · ${c.originalEntry.partyName || c.originalEntry.itemName} · Outstanding ${fmt(c.remainingBalance)}`, creditId === c.originalEntry.id, () => { setCreditId(c.originalEntry.id); setConfirmed(false); }))}
        </ScrollView>
      </>}
      <Text style={text}>Supporting reference</Text>
      <TextInput value={reference} onChangeText={setReference} editable={!busy} maxLength={200} accessibilityLabel="Supporting reference" testID="input-return-credit-reference"
        style={[text, { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12 }]} />
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: confirmed }} disabled={busy} onPress={() => setConfirmed(v => !v)} testID="confirm-return-credit">
        <Text style={text}>{confirmed ? '[✓]' : '[ ]'} {selected.returnCreditEntryId ? 'I confirm this return was settled with money.' : `No money was refunded or received. Reduce ${kind === 'sale' ? 'Debtors' : 'Creditors'} by ${fmt(returnCreditAmount(selected))} instead.`}</Text>
      </Pressable>
      <Pressable onPress={() => void save()} testID="save-return-credit" accessibilityRole="button"
        disabled={busy || loading || !!error || !confirmed || !reference.trim() || (!selected.returnCreditEntryId && !creditId)}
        style={{ backgroundColor: colors.primary, borderRadius: 10, padding: 14, opacity: busy || !confirmed || !reference.trim() || (!selected.returnCreditEntryId && !creditId) ? .5 : 1 }}>
        <Text style={{ color: colors.primaryForeground, textAlign: 'center', fontFamily: 'Inter_600SemiBold' }}>{busy ? 'Saving…' : selected.returnCreditEntryId ? 'Remove credit link' : 'Confirm credit link'}</Text>
      </Pressable>
    </>}
    {(message || error) && <Text accessibilityRole="alert" style={text}>{message || error}</Text>}
  </View>;
}
