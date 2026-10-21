import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { ArrowLeft, AlertTriangle } from 'lucide-react-native';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { useEntries } from '@/context/EntriesContext';
import { calcInventoryValueAsOf, getOutstandingCredits } from '@/lib/utils/formulas';
import {
  getAccountingLedger, saveOpeningBalance, deleteOpeningBalance,
  createOwnerMovement, updateOwnerMovement, deleteOwnerMovement,
} from '@/lib/equityLedgerApi';
import { getFinancialRecords } from '@/lib/financeApi';
import {
  openingTotals, validateOpeningPayload, validateOwnerPayload,
  type AccountingRecord, type OpeningBalances, type OpeningPayload, type OwnerPayload,
} from '@/lib/utils/equityLedger';

type BKey = keyof OpeningBalances;
const SIGNED: BKey[] = ['bank', 'retainedEarnings', 'otherEquity'];
const AUTO: BKey[] = ['inventory', 'debtors', 'creditors'];
const GROUPS: { title: string; fields: { key: BKey; label: string; hint?: string }[] }[] = [
  { title: 'Assets', fields: [
    { key: 'cash', label: 'Cash on hand' },
    { key: 'bank', label: 'Bank balance', hint: 'Negative allowed (overdraft)' },
    { key: 'inventory', label: 'Inventory (stock value)' },
    { key: 'debtors', label: 'Debtors (owed to you)' },
    { key: 'otherCurrentAssets', label: 'Other current assets' },
    { key: 'fixedAssets', label: 'Fixed assets (net carrying amount)', hint: 'Net book value only. Not an asset register or depreciation schedule.' },
    { key: 'otherNonCurrentAssets', label: 'Other non-current assets' },
  ] },
  { title: 'Liabilities', fields: [
    { key: 'creditors', label: 'Supplier / expense creditors (from credit records)' },
    { key: 'vatLiability', label: 'VAT payable', hint: 'Confirmation only, not a tax settlement.' },
    { key: 'whtLiability', label: 'WHT payable', hint: 'Confirmation only.' },
    { key: 'incomeTaxLiability', label: 'Income tax payable', hint: 'Confirmation only.' },
    { key: 'otherCurrentLiabilities', label: 'Other creditors / current payables (excluding suppliers and tax)', hint: 'Include short-term obligations here. Do not repeat supplier debts or long-term loan balances.' },
    { key: 'loans', label: 'Long-term loans / non-current obligations', hint: 'Enter the outstanding balance once; exclude amounts already included in supplier or other current creditors.' },
  ] },
  { title: 'Equity', fields: [
    { key: 'capital', label: 'Owner capital' },
    { key: 'retainedEarnings', label: 'Retained earnings', hint: 'Negative allowed' },
    { key: 'drawings', label: 'Drawings' },
    { key: 'otherEquity', label: 'Other equity', hint: 'Negative allowed' },
  ] },
];

const today = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const money = (n: number) => `${n < 0 ? '−' : ''}₦${Math.abs(n).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const newRequestId = () => `own_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
const r2 = (n: number) => Math.round(n * 100) / 100;
const parse = (v: string) => (v.trim() === '' || !/^-?\d*\.?\d*$/.test(v.trim()) ? NaN : Number(v));
const errText = (e: unknown) => {
  const m = e instanceof Error ? e.message : 'Something went wrong';
  return /revision|conflict|stale/i.test(m) ? `${m} Reload the latest records and re-check before saving again.` : m;
};
const confirmAsync = (title: string, message: string, action: string) =>
  new Promise<boolean>(resolve => {
    if (Platform.OS === 'web') { resolve(typeof window !== 'undefined' ? window.confirm(`${title}\n\n${message}`) : false); return; }
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: action, onPress: () => resolve(true) },
    ], { onDismiss: () => resolve(false) });
  });

export default function EquityScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { entries, products, loading: entriesLoading, error: entriesError, productsLoading, retry: retryEntries } = useEntries();
  const uid = user?.uid ?? null;
  const topInset = Platform.OS === 'web' ? 67 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 34 : insets.bottom;

  const [opening, setOpening] = useState<AccountingRecord | null>(null);
  const [movements, setMovements] = useState<AccountingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [date, setDate] = useState(today());
  const [vals, setVals] = useState<Record<string, string>>({});
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [openBusy, setOpenBusy] = useState(false);
  const [openError, setOpenError] = useState('');

  const [kind, setKind] = useState<'contribution' | 'drawings'>('contribution');
  const [account, setAccount] = useState<'cash' | 'bank'>('cash');
  const [amount, setAmount] = useState('');
  const [oDate, setODate] = useState(today());
  const [ownerName, setOwnerName] = useState('');
  const [oRef, setORef] = useState('');
  const [oNotes, setONotes] = useState('');
  const [editing, setEditing] = useState<AccountingRecord | null>(null);
  const [ownerBusy, setOwnerBusy] = useState(false);
  const [ownerError, setOwnerError] = useState('');
  const requestId = useRef(newRequestId());
  const [voidTarget, setVoidTarget] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidBusy, setVoidBusy] = useState(false);
  const [voidError, setVoidError] = useState('');
  const [finActive, setFinActive] = useState(0);
  const loadSeq = useRef(0);
  const [revision, setRevision] = useState(0);
  const latestUid = useRef<string | null>(uid);
  latestUid.current = uid;
  const busyRef = useRef(false);
  const sourcesReady = !entriesLoading && !productsLoading && !entriesError;

  const activeMovements = movements.filter(m => m.ledgerStatus === 'active');

  const resetOwner = useCallback(() => {
    setKind('contribution'); setAccount('cash'); setAmount(''); setODate(today()); setOwnerName('');
    setORef(''); setONotes(''); setEditing(null); setOwnerError(''); requestId.current = newRequestId();
  }, []);

  const fillOpening = useCallback((rec: AccountingRecord | null) => {
    const v: Record<string, string> = {};
    if (rec?.openingBalances) for (const k of Object.keys(rec.openingBalances) as BKey[]) v[k] = String(rec.openingBalances[k]);
    setVals(v); setDate(rec?.date ?? today()); setReference(rec?.reference ?? ''); setNotes(rec?.notes ?? ''); setConfirmed(false); setOpenError('');
  }, []);

  const load = useCallback(async (fill = true) => {
    const reqUid = uid;
    const seq = ++loadSeq.current;
    setLoading(true); setLoadError('');
    try {
      const res = await getAccountingLedger();
      const fin = await getFinancialRecords();
      if (seq !== loadSeq.current || latestUid.current !== reqUid) return;
      setFinActive(fin.records.filter(r => r.ledgerStatus !== 'void').length); setRevision(res.openingRevision); setOpening(res.opening); setMovements(res.movements);
      if (fill) fillOpening(res.opening);
    } catch (e) {
      if (seq === loadSeq.current && latestUid.current === reqUid) setLoadError(errText(e));
    } finally {
      if (seq === loadSeq.current && latestUid.current === reqUid) setLoading(false);
    }
  }, [fillOpening, uid]);

  useEffect(() => {
    loadSeq.current++;
    setOpening(null); setMovements([]); setRevision(0); fillOpening(null); busyRef.current = false; setOpenBusy(false); setOwnerBusy(false); setVoidBusy(false); resetOwner(); setVoidTarget(null); setVoidReason('');
    if (!uid) { setLoading(false); return; }
    void load(true);
  }, [uid, load, fillOpening, resetOwner]);

  const entriesAsOf = useMemo(() => entries.filter(e => e.date <= date && !String(e.type).startsWith('opening_balance') && !String(e.type).startsWith('owner_')), [entries, date]);
  const auto = useMemo(() => ({
    inventory: r2(calcInventoryValueAsOf(products, entries, date)),
    debtors: r2(getOutstandingCredits(entriesAsOf, 'sale').reduce((s, c) => s + c.remainingBalance, 0)),
    creditors: r2(getOutstandingCredits(entriesAsOf, 'purchase').reduce((s, c) => s + c.remainingBalance, 0)),
  }), [products, entries, entriesAsOf, date]);

  const valueOf = (k: BKey) => (AUTO.includes(k) ? (auto as Record<string, number>)[k] : parse(vals[k] ?? ''));
  const missing = GROUPS.flatMap(g => g.fields).filter(f => (AUTO.includes(f.key) && !sourcesReady) || Number.isNaN(valueOf(f.key)));
  const balances = useMemo(() => {
    const b = {} as OpeningBalances;
    for (const g of GROUPS) for (const f of g.fields) {
      const n = AUTO.includes(f.key) ? (auto as Record<string, number>)[f.key] : parse(vals[f.key] ?? '');
      b[f.key] = Number.isNaN(n) ? 0 : n;
    }
    return b;
  }, [vals, auto]);
  const totals = openingTotals(balances);
  const balanced = missing.length === 0 && Math.abs(r2(totals.difference)) < 0.005;
  const dateLocked = !!opening && (activeMovements.length > 0 || finActive > 0);
  const canSave = sourcesReady && !openBusy && balanced && confirmed && !!reference.trim() && !!date;

  const submitOpening = async () => {
    if (busyRef.current || openBusy || !sourcesReady) return;
    busyRef.current = true;
    const mu = uid;
    try {
      setOpenError('');
      const payload: OpeningPayload = { date, balances, reference: reference.trim(), notes: notes.trim(), confirmed: true, expectedRevision: revision };
      try { validateOpeningPayload(payload); } catch (e) { setOpenError(errText(e)); return; }
      const ok = await confirmAsync('Set opening balances?', `As at ${date}. This is an audited correction: Cash and Bank are re-anchored to this date. Earlier transactions stay on record but stop affecting money balances.`, 'Save');
      if (!ok || latestUid.current !== mu) return;
      setOpenBusy(true);
      await saveOpeningBalance(payload);
      if (latestUid.current !== mu) return;
      
      await load(true);
    } catch (e) {
      if (latestUid.current === mu) setOpenError(errText(e));
    } finally {
      busyRef.current = false;
      if (latestUid.current === mu) setOpenBusy(false);
    }
  };

  const clearOpening = async () => {
    if (busyRef.current || !opening || openBusy || activeMovements.length > 0 || finActive > 0) return;
    busyRef.current = true;
    const mu = uid;
    try {
      const ok = await confirmAsync('Clear opening balances?', 'This resets the monetary anchoring (the baseline cutoff). Prior transactions and records are preserved, not deleted.', 'Clear');
      if (!ok || latestUid.current !== mu) return;
      setOpenBusy(true); setOpenError('');
      await deleteOpeningBalance(revision);
      if (latestUid.current !== mu) return;
      
      await load(true);
    } catch (e) {
      if (latestUid.current === mu) setOpenError(errText(e));
    } finally {
      busyRef.current = false;
      if (latestUid.current === mu) setOpenBusy(false);
    }
  };

  const startEdit = (m: AccountingRecord) => {
    setEditing(m); setKind(m.type === 'owner_drawings' ? 'drawings' : 'contribution');
    setAccount(m.paymentMode === 'bank' ? 'bank' : 'cash'); setAmount(String(m.amount)); setODate(m.date);
    setOwnerName(m.ownerName ?? ''); setORef(m.reference ?? ''); setONotes(m.notes ?? ''); setOwnerError('');
  };

  const submitOwner = async () => {
    if (busyRef.current || ownerBusy || !opening) return;
    busyRef.current = true;
    const mu = uid;
    try {
      setOwnerError('');
      const n = Number(amount);
      const payload: OwnerPayload = {
        kind, account, amount: amount.trim() !== '' && Number.isFinite(n) ? n : NaN, date: oDate, ownerName: ownerName.trim(), reference: oRef.trim(), notes: oNotes.trim(),
        requestId: editing ? editing.id : requestId.current,
        ...(editing ? { expectedRevision: editing.ledgerRevision } : {}),
      };
      try { validateOwnerPayload(payload, opening.date); } catch (e) { setOwnerError(errText(e)); return; }
      const ok = await confirmAsync(editing ? 'Update movement?' : 'Record movement?', `${editing ? 'Update (audited correction of)' : 'Record'} owner ${kind} of ${money(payload.amount)} via ${account}?`, 'Confirm');
      if (!ok || latestUid.current !== mu) return;
      setOwnerBusy(true);
      if (editing) await updateOwnerMovement(editing.id, payload); else await createOwnerMovement(payload);
      if (latestUid.current !== mu) return;
      
      resetOwner(); await load(false);
    } catch (e) {
      if (latestUid.current === mu) setOwnerError(errText(e));
    } finally {
      busyRef.current = false;
      if (latestUid.current === mu) setOwnerBusy(false);
    }
  };

  const submitVoid = async (m: AccountingRecord) => {
    if (busyRef.current || voidBusy) return;
    if (!voidReason.trim()) { setVoidError('Enter a reason for voiding.'); return; }
    busyRef.current = true;
    const mu = uid;
    setVoidBusy(true); setVoidError('');
    try {
      await deleteOwnerMovement(m.id, m.ledgerRevision, voidReason.trim());
      if (latestUid.current !== mu) return;
      
      setVoidTarget(null); setVoidReason(''); if (editing?.id === m.id) resetOwner();
      await load(false);
    } catch (e) {
      if (latestUid.current === mu) setVoidError(errText(e));
    } finally {
      busyRef.current = false;
      if (latestUid.current === mu) setVoidBusy(false);
    }
  };

  const input = (extra?: object) => [st.input, { borderColor: colors.input, backgroundColor: colors.background, color: colors.foreground }, extra];
  const Btn = ({ label, onPress, disabled, busy, danger, outline, testID }: { label: string; onPress: () => void; disabled?: boolean; busy?: boolean; danger?: boolean; outline?: boolean; testID?: string }) => (
    <Pressable testID={testID} onPress={onPress} disabled={disabled || busy}
      style={({ pressed }) => [st.btn, outline ? { borderWidth: 1, borderColor: danger ? colors.destructive : colors.border } : { backgroundColor: danger ? colors.destructive : colors.primary },
        { opacity: disabled || busy ? 0.5 : pressed ? 0.8 : 1 }]}>
      {busy ? <ActivityIndicator size="small" color={outline ? colors.foreground : colors.primaryForeground} /> :
        <Text style={[st.btnText, { color: outline ? (danger ? colors.destructive : colors.foreground) : colors.primaryForeground }]}>{label}</Text>}
    </Pressable>
  );
  const Chip = ({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) => (
    <Pressable onPress={onPress} disabled={ownerBusy} style={[st.chip, { backgroundColor: active ? colors.primary : colors.background, borderColor: active ? colors.primary : colors.border }]}>
      <Text style={[st.chipText, { color: active ? colors.primaryForeground : colors.mutedForeground }]}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={[st.container, { backgroundColor: colors.background }]}>
      <View style={[st.header, { backgroundColor: colors.card, paddingTop: topInset + 8, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} testID="button-back-equity"><ArrowLeft size={22} color={colors.foreground} /></Pressable>
        <Text style={[st.title, { color: colors.foreground }]} numberOfLines={1}>Opening Balances & Equity</Text>
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: bottomInset + 40, gap: 14 }} keyboardShouldPersistTaps="handled">
          {!uid ? <Text style={{ color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }}>Sign in to manage opening balances.</Text>
            : loading ? (
              <View style={{ gap: 12 }}>{[0, 1, 2].map(i => <View key={i} style={{ height: 90, borderRadius: 12, backgroundColor: colors.muted }} />)}</View>
            ) : loadError ? (
              <View style={[st.card, { backgroundColor: colors.card, borderColor: colors.destructive }]}>
                <Text style={{ color: colors.destructive, fontFamily: 'Inter_600SemiBold' }}>{loadError}</Text>
                <Btn label="Retry" onPress={() => void load()} testID="button-retry-ledger" />
              </View>
            ) : (
              <>
                <View style={[st.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[st.h2, { color: colors.foreground }]}>Opening balances</Text>
                  <Text style={[st.small, { color: colors.mutedForeground }]}>
                    {opening ? `Active as at ${opening.date} · Ref ${opening.reference || 'none'} · Revision ${opening.ledgerRevision} · Verified against supporting records` : 'No opening balances set yet.'}
                  </Text>
                  <View style={[st.warn, { borderColor: '#D97706', backgroundColor: colors.muted }]}>
                    <AlertTriangle size={16} color="#D97706" />
                    <Text style={[st.small, { color: colors.foreground, flex: 1 }]}>
                      Opening balances as at {date}
                    </Text>
                  </View>
                  {!sourcesReady && (
                    <View style={[st.warn, { borderColor: colors.destructive, backgroundColor: colors.muted }]} testID="status-sources">
                      <Text style={[st.small, { color: colors.foreground, flex: 1 }]}>{entriesError ? `Could not load your records: ${entriesError}` : 'Loading your products and credit records. Saving is disabled until they load.'}</Text>
                      {!!entriesError && <Pressable onPress={retryEntries} testID="button-retry-sources"><Text style={{ color: colors.primary, fontFamily: 'Inter_700Bold' }}>Retry</Text></Pressable>}
                    </View>
                  )}
                  <Text style={[st.label, { color: colors.foreground }]}>Opening date (YYYY-MM-DD)</Text>
                  <TextInput style={input(dateLocked ? { opacity: 0.5 } : undefined)} value={date} onChangeText={setDate} editable={!dateLocked && !openBusy} placeholder="2025-01-01" placeholderTextColor={colors.mutedForeground} autoCapitalize="none" testID="input-opening-date" />
                  {dateLocked && <Text style={[st.small, { color: colors.mutedForeground }]}>Locked while active owner movements exist. Void them first.</Text>}

                  {GROUPS.map(g => (
                    <View key={g.title} style={{ gap: 6 }}>
                      <Text style={[st.section, { color: colors.mutedForeground }]}>{g.title}</Text>
                      {g.fields.map(f => {
                        const ro = AUTO.includes(f.key);
                        return (
                          <View key={f.key} style={{ gap: 4 }}>
                            <Text style={[st.label, { color: colors.foreground }]}>{f.label}</Text>
                            <TextInput
                              style={input(ro ? { opacity: 0.6 } : undefined)}
                              value={ro ? (sourcesReady ? String(auto[f.key as 'inventory' | 'debtors' | 'creditors']) : 'Loading…') : vals[f.key] ?? ''}
                              editable={!ro && !openBusy}
                              onChangeText={t => setVals(v => ({ ...v, [f.key]: t }))}
                              keyboardType={SIGNED.includes(f.key) ? 'numbers-and-punctuation' : 'decimal-pad'}
                              placeholder="0.00 (enter 0 if none)" placeholderTextColor={colors.mutedForeground}
                              testID={`input-opening-${f.key}`}
                            />
                            {ro ? <Text style={[st.small, { color: colors.mutedForeground }]}>Read-only. Correct via existing {f.key === 'inventory' ? 'Products' : 'credit records'} first.</Text>
                              : f.hint ? <Text style={[st.small, { color: colors.mutedForeground }]}>{f.hint}</Text> : null}
                          </View>
                        );
                      })}
                    </View>
                  ))}

                  <View style={[st.totals, { backgroundColor: colors.muted }]} testID="panel-opening-totals">
                    {([['Assets', totals.assets], ['Liabilities', totals.liabilities], ['Equity', totals.equity], ['Difference', totals.difference]] as [string, number][]).map(([l, v]) => (
                      <View key={l} style={st.trow}>
                        <Text style={[st.small, { color: colors.foreground }]}>{l}</Text>
                        <Text style={[st.tval, { color: l === 'Difference' ? (balanced ? colors.primary : colors.destructive) : colors.foreground }]}>{money(v)}</Text>
                      </View>
                    ))}
                    <Text style={[st.small, { color: colors.mutedForeground }]}>
                      {missing.length > 0 ? `${missing.length} field(s) still blank. Enter 0 where nothing applies.` : balanced ? 'Balanced to the cent.' : 'Assets must equal liabilities plus equity before saving.'}
                    </Text>
                  </View>

                  <Text style={[st.label, { color: colors.foreground }]}>Supporting document reference</Text>
                  <TextInput style={input()} value={reference} onChangeText={setReference} editable={!openBusy} placeholder="e.g. Bank statement Jan 2025" placeholderTextColor={colors.mutedForeground} testID="input-opening-reference" />
                  <Text style={[st.label, { color: colors.foreground }]}>Notes</Text>
                  <TextInput style={input({ height: 70, textAlignVertical: 'top' })} value={notes} onChangeText={setNotes} editable={!openBusy} multiline testID="input-opening-notes" />
                  <View style={st.trow}>
                    <Text style={[st.small, { color: colors.foreground, flex: 1 }]}>I checked all opening balances against supporting records</Text>
                    <Switch value={confirmed} onValueChange={setConfirmed} disabled={openBusy} testID="checkbox-opening-confirm" />
                  </View>
                  {!!openError && <Text style={{ color: colors.destructive, fontFamily: 'Inter_500Medium', fontSize: 13 }} testID="text-opening-error">{openError}</Text>}
                  <Btn label={opening ? 'Update opening balances' : 'Set opening balances'} onPress={() => void submitOpening()} disabled={!canSave} busy={openBusy} testID="button-save-opening" />
                  {opening && <Btn label="Clear opening balances" onPress={() => void clearOpening()} disabled={activeMovements.length > 0 || finActive > 0} busy={false} outline danger testID="button-clear-opening" />}
                  {opening && finActive > 0 && <Text style={[st.small, { color: colors.mutedForeground }]}>Active financial records exist. Void them in Financial Controls first.</Text>}
                  {opening && activeMovements.length > 0 && <Text style={[st.small, { color: colors.mutedForeground }]}>Clearing is disabled until all active owner movements are voided.</Text>}
                </View>

                <View style={[st.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[st.h2, { color: colors.foreground }]}>{editing ? 'Edit owner movement' : 'Owner contribution / drawings'}</Text>
                  {!opening ? (
                    <Text style={[st.small, { color: colors.mutedForeground }]}>Set opening balances first. Owner movements are dated after the opening date.</Text>
                  ) : (
                    <>
                      <Text style={[st.small, { color: colors.mutedForeground }]}>Not a sale or expense, no VAT. Must be dated after {opening.date}.</Text>
                      <View style={st.row}><Chip label="Owner contribution" active={kind === 'contribution'} onPress={() => setKind('contribution')} /><Chip label="Drawings" active={kind === 'drawings'} onPress={() => setKind('drawings')} /></View>
                      <View style={st.row}><Chip label="Cash" active={account === 'cash'} onPress={() => setAccount('cash')} /><Chip label="Bank" active={account === 'bank'} onPress={() => setAccount('bank')} /></View>
                      <Text style={[st.label, { color: colors.foreground }]}>Amount (₦)</Text>
                      <TextInput style={input()} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" editable={!ownerBusy} placeholder="0.00" placeholderTextColor={colors.mutedForeground} testID="input-owner-amount" />
                      <Text style={[st.label, { color: colors.foreground }]}>Date (YYYY-MM-DD)</Text>
                      <TextInput style={input()} value={oDate} onChangeText={setODate} editable={!ownerBusy} autoCapitalize="none" testID="input-owner-date" />
                      <Text style={[st.label, { color: colors.foreground }]}>Owner name</Text>
                      <TextInput style={input()} value={ownerName} onChangeText={setOwnerName} editable={!ownerBusy} testID="input-owner-name" />
                      <Text style={[st.label, { color: colors.foreground }]}>Reference</Text>
                      <TextInput style={input()} value={oRef} onChangeText={setORef} editable={!ownerBusy} testID="input-owner-reference" />
                      <Text style={[st.label, { color: colors.foreground }]}>Notes</Text>
                      <TextInput style={input({ height: 60, textAlignVertical: 'top' })} value={oNotes} onChangeText={setONotes} editable={!ownerBusy} multiline testID="input-owner-notes" />
                      {!!ownerError && <Text style={{ color: colors.destructive, fontFamily: 'Inter_500Medium', fontSize: 13 }} testID="text-owner-error">{ownerError}</Text>}
                      <Btn label={editing ? 'Save changes' : 'Record movement'} onPress={() => void submitOwner()} busy={ownerBusy} testID="button-save-owner" />
                      {editing && <Btn label="Cancel" onPress={resetOwner} disabled={ownerBusy} outline testID="button-cancel-edit" />}
                    </>
                  )}
                </View>

                <View style={[st.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[st.h2, { color: colors.foreground }]}>Owner movements</Text>
                  {movements.length === 0 ? <Text style={[st.small, { color: colors.mutedForeground }]}>No owner contributions or drawings recorded.</Text> : movements.map(m => {
                    const isVoid = m.ledgerStatus === 'void';
                    return (
                      <View key={m.id} style={[st.mov, { borderColor: colors.border, opacity: isVoid ? 0.6 : 1 }]} testID={`row-movement-${m.id}`}>
                        <View style={st.trow}>
                          <Text style={{ flex: 1, color: colors.foreground, fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>
                            {m.type === 'owner_drawings' ? 'Drawings' : 'Contribution'} · {m.paymentMode === 'bank' ? 'Bank' : 'Cash'} · {isVoid ? 'Void' : 'Active'}
                          </Text>
                          <Text style={{ color: colors.foreground, fontFamily: 'Inter_700Bold', textDecorationLine: isVoid ? 'line-through' : 'none' }}>{money(m.amount)}</Text>
                        </View>
                        <Text style={[st.small, { color: colors.mutedForeground }]}>{m.date}{m.ownerName ? ` · ${m.ownerName}` : ''}{m.reference ? ` · Ref ${m.reference}` : ''}</Text>
                        {!!m.notes && <Text style={[st.small, { color: colors.foreground }]}>{m.notes}</Text>}
                        {!isVoid && (
                          <View style={st.row}>
                            <Btn label="Edit" onPress={() => startEdit(m)} outline testID={`button-edit-movement-${m.id}`} />
                            <Btn label="Void" onPress={() => { setVoidTarget(voidTarget === m.id ? null : m.id); setVoidReason(''); setVoidError(''); }} outline danger testID={`button-void-movement-${m.id}`} />
                          </View>
                        )}
                        {voidTarget === m.id && (
                          <View style={{ gap: 6 }}>
                            <TextInput style={input()} value={voidReason} onChangeText={setVoidReason} editable={!voidBusy} placeholder="Reason for voiding (required)" placeholderTextColor={colors.mutedForeground} testID={`input-void-reason-${m.id}`} />
                            {!!voidError && <Text style={{ color: colors.destructive, fontSize: 12 }}>{voidError}</Text>}
                            <Btn label="Confirm void" onPress={() => void submitVoid(m)} busy={voidBusy} danger testID={`button-confirm-void-${m.id}`} />
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              </>
            )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const st = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { flex: 1, fontSize: 18, fontFamily: 'Inter_700Bold' },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 14, gap: 8 },
  h2: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  small: { fontSize: 12, lineHeight: 17, fontFamily: 'Inter_400Regular' },
  label: { fontSize: 13, fontFamily: 'Inter_600SemiBold', marginTop: 4 },
  section: { fontSize: 12, fontFamily: 'Inter_700Bold', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 10 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, height: 46, fontSize: 15, fontFamily: 'Inter_400Regular' },
  btn: { height: 46, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, flexGrow: 1 },
  btnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  chipText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  trow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  tval: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  totals: { borderRadius: 10, padding: 12, gap: 4, marginTop: 8 },
  warn: { flexDirection: 'row', gap: 8, borderWidth: 1, borderRadius: 10, padding: 10, alignItems: 'flex-start' },
  mov: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 10, gap: 6 },
});
