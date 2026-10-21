import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { ArrowLeft } from 'lucide-react-native';
import { useColors } from '@/hooks/useColors';
import { ReturnCreditReview } from '@/components/ReturnCreditReview';
import { useAuth } from '@/context/AuthContext';
import { useEntries } from '@/context/EntriesContext';
import { buildTaxControlLedger, taxControlRows, taxDraftFromParams } from '@workspace/accounting-core';
import { getEntryVAT } from '@/lib/utils/formulas';
import { workingPosition, workingBalance, type WorkingCapitalRecord } from '@workspace/accounting-core';
import { emptyWorking, buildWorking, formFromRecord, actionOptions, actionLabel, effectText, needsOriginal, isMoney, openingInfo, openingRoom, originals, ACCOUNT_OPTIONS, type WorkingForm } from '@/lib/workingUi';
import { calcMoneyAccountBalances } from '@/lib/utils/moneyAccounts';
import { getFinancialRecords, saveFinancialRecord, voidFinancialRecord, extractStatement, type SavedFinance } from '@/lib/financeApi';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { accumulatedDepreciation, assetCarrying, parseCSV, type AssetRecord, type FinanceRecord, type TaxRecord, type StatementRecord, type StatementColumns } from '@workspace/accounting-core';
import {
  today, fmt, newFinanceId, errText, num, emptyAsset, emptyTax, emptyStatement, buildAsset, buildTax, buildStatement, statementDiff,
  bankMovements, getEntryPaymentMode, taxSourceCandidates, mapTable, groupKey, activeStatements, reconcileGroup,
  type AssetForm, type TaxForm, type StatementForm, type DraftRow,
} from '@/lib/financeUi';

type Tab = 'assets' | 'taxes' | 'working' | 'statements' | 'returns';
const TABN: Record<Tab, string> = { assets: 'Assets', taxes: 'Taxes', working: 'Working capital & loans', statements: 'Bank rec.', returns: 'Return credits' };
const TAXN = { vat: 'VAT', wht: 'WHT', income_tax: 'Income tax' } as const;
const confirmAsync = (title: string, message: string, action: string) => new Promise<boolean>(resolve => {
  if (Platform.OS === 'web') { resolve(typeof window !== 'undefined' ? window.confirm(`${title}\n\n${message}`) : false); return; }
  Alert.alert(title, message, [{ text: 'Cancel', style: 'cancel', onPress: () => resolve(false) }, { text: action, onPress: () => resolve(true) }], { onDismiss: () => resolve(false) });
});

export default function FinanceScreen() {
  const params = useLocalSearchParams<{ tab?: string; taxType?: string; action?: string; amount?: string; date?: string }>();
  const colors = useColors(); const insets = useSafeAreaInsets();
  const { user } = useAuth(); const { entries, loading: eLoading, error: eError, retry } = useEntries();
  const uid = user?.uid ?? null; const latestUid = useRef(uid); latestUid.current = uid;
  const topInset = Platform.OS === 'web' ? 67 : insets.top; const bottomInset = Platform.OS === 'web' ? 34 : insets.bottom;
  const loadSeq = useRef(0); const busyRef = useRef(false);
  const [tab, setTab] = useState<Tab>('assets');
  const [records, setRecords] = useState<SavedFinance[]>([]);
  const [loading, setLoading] = useState(true); const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const sourcesReady = !eLoading && !eError;
  const [editId, setEditId] = useState(() => newFinanceId()); const [editRev, setEditRev] = useState(0); const [editing, setEditing] = useState(false);
  const [af, setAf] = useState<AssetForm>(emptyAsset()); const [tf, setTf] = useState<TaxForm>(emptyTax());
  const [sf, setSf] = useState<StatementForm>(emptyStatement()); const [rows, setRows] = useState<DraftRow[]>([]); const [outstanding, setOutstanding] = useState<string[]>([]);
  const [csvText, setCsvText] = useState(''); const [table, setTable] = useState<string[][]>([]); const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [importWarnings,setImportWarnings]=useState<string[]>([]);
  const [cols, setCols] = useState({ date: '0', description: '1', mode: 'signed' as 'signed' | 'split', amount: '2', debit: '2', credit: '3', reference: '', fmt: 'DMY' as 'DMY' | 'MDY' });
  const [mapErrors, setMapErrors] = useState<{ index: number; message: string }[]>([]);
  const [wf, setWf] = useState<WorkingForm>(emptyWorking()); const [lastResult, setLastResult] = useState('');
  const [voidId, setVoidId] = useState<string | null>(null); const [voidReason, setVoidReason] = useState('');
  const [pickRow, setPickRow] = useState<string | null>(null);

  const resetForms = useCallback(() => {
    setEditId(newFinanceId()); setEditRev(0); setEditing(false); setAf(emptyAsset()); setTf(emptyTax()); setSf(emptyStatement()); setWf(emptyWorking());
    setRows([]); setOutstanding([]); setTable([]); setCsvText(''); setImportWarnings([]); setExcluded(new Set()); setMapErrors([]); setError(''); setPickRow(null);
  }, []);
  const load = useCallback(async () => {
    const reqUid = uid; const seq = ++loadSeq.current; setLoading(true); setLoadError('');
    try { const res = await getFinancialRecords(); if (seq !== loadSeq.current || latestUid.current !== reqUid) return; setRecords(res.records); }
    catch (e) { if (seq === loadSeq.current && latestUid.current === reqUid) setLoadError(errText(e)); }
    finally { if (seq === loadSeq.current && latestUid.current === reqUid) setLoading(false); }
  }, [uid]);
  useEffect(() => { loadSeq.current++; setRecords([]); setLastResult(''); setVoidId(null); setVoidReason(''); busyRef.current = false; setBusy(false); resetForms(); if (!uid) { setLoading(false); return; } void load(); }, [uid, load, resetForms]);
  useEffect(() => {
    if (params.tab === 'returns') setTab('returns');
    if (uid && params.tab === 'taxes') {
      resetForms(); setTab('taxes');
      setTf({ ...emptyTax(), ...taxDraftFromParams({ taxType: params.taxType, action: params.action, amount: params.amount, date: params.date }, today()) });
    }
  }, [uid, params.tab, params.taxType, params.action, params.amount, params.date, resetForms]);

  const movements = useMemo(() => (sourcesReady ? bankMovements(entries) : []), [entries, sourcesReady]);
  const taxSources = useMemo(() => taxSourceCandidates(entries, records, tf.source), [entries, records, tf.source]);
  const equipment = useMemo(() => entries.filter(e => e.type === 'expense' && /equipment/i.test(e.category ?? '') && e.ledgerStatus !== 'void'), [entries]);

  const submit = async (build: () => FinanceRecord, done: string) => {
    if (busyRef.current || busy || !sourcesReady) return;
    busyRef.current = true; const mu = uid;
    try {
      setError(''); let rec: FinanceRecord; try { rec = build(); } catch (e) { setError(errText(e)); return; }
      setBusy(true); await saveFinancialRecord(editId, editRev, rec);
      if (latestUid.current !== mu) return;
      setLastResult(`${done} · ${new Date().toLocaleTimeString()}`); resetForms(); await load(); retry(); Alert.alert(done);
    } catch (e) { if (latestUid.current === mu) setError(errText(e)); }
    finally { busyRef.current = false; if (latestUid.current === mu) setBusy(false); }
  };
  const doVoid = async (r: SavedFinance) => {
    if (busyRef.current || busy) return;
    if (!voidReason.trim()) { setError('Enter a reason for voiding.'); return; }
    if (!(await confirmAsync('Void this record?', 'It stays on file but stops affecting reports.', 'Void'))) return;
    busyRef.current = true; const mu = uid; setBusy(true); setError('');
    try { await voidFinancialRecord(r.id, r.ledgerRevision, voidReason.trim()); if (latestUid.current !== mu) return; setVoidId(null); setVoidReason(''); setLastResult(`Record voided (kept on file) · ${new Date().toLocaleTimeString()}`); if (editId === r.id) resetForms(); await load(); retry(); }
    catch (e) { if (latestUid.current === mu) setError(errText(e)); }
    finally { busyRef.current = false; if (latestUid.current === mu) setBusy(false); }
  };
  const edit = (r: SavedFinance) => {
    resetForms(); setEditId(r.id); setEditRev(r.ledgerRevision); setEditing(true); const f = r.finance;
    if (f.kind === 'asset') { setTab('assets'); setAf({ name: f.name, cost: String(f.cost), residual: String(f.residualValue), life: String(f.usefulLifeMonths), date: f.date, depStart: f.depreciationStart, mode: f.paymentMode, source: f.sourceEntryId, reference: f.reference, notes: f.notes, dispose: !!f.disposalDate, dDate: f.disposalDate ?? today(), dProceeds: f.disposalProceeds !== undefined ? String(f.disposalProceeds) : '', dAccount: f.disposalAccount ?? 'bank' }); }
    else if (f.kind === 'tax') { setTab('taxes'); setTf({ taxType: f.taxType, action: f.action, amount: String(f.amount), date: f.date, mode: f.paymentMode === 'cash' ? 'cash' : 'bank', confirmed: false, reference: f.reference, notes: f.notes, source: f.sourceEntryId ?? '' }); }
    else if (f.kind === 'working_capital') { setTab('working'); setWf(formFromRecord(f)); }
    else {
      setTab('statements');
      setSf({ bankName: f.bankName, accountLabel: f.accountLabel, start: f.startDate, end: f.endDate, opening: String(f.openingBalance), closing: String(f.closingBalance), reference: f.reference, notes: f.notes, coverage: f.completeBankCoverage });
      setRows(f.rows.map(x => ({ id: x.id, date: x.date, description: x.description, amount: String(x.amount), reference: x.reference, matchedEntryId: x.matchedEntryId ?? '' }))); setOutstanding(f.outstandingEntryIds);
    }
  };

  // ---- UI atoms
  const inp = (extra?: object) => [st.input, { borderColor: colors.input, backgroundColor: colors.background, color: colors.foreground }, extra];
  const T = ({ children, style }: { children: React.ReactNode; style?: object }) => <Text style={[st.small, { color: colors.mutedForeground }, style]}>{children}</Text>;
  const L = ({ children }: { children: string }) => <Text style={[st.label, { color: colors.foreground }]}>{children}</Text>;
  const Btn = ({ label, onPress, disabled, danger, outline, testID }: { label: string; onPress: () => void; disabled?: boolean; danger?: boolean; outline?: boolean; testID?: string }) => (
    <Pressable testID={testID} onPress={onPress} disabled={disabled || busy} style={({ pressed }) => [st.btn, outline ? { borderWidth: 1, borderColor: danger ? colors.destructive : colors.border } : { backgroundColor: danger ? colors.destructive : colors.primary }, { opacity: disabled || busy ? 0.5 : pressed ? 0.8 : 1 }]}>
      <Text style={[st.btnText, { color: outline ? (danger ? colors.destructive : colors.foreground) : colors.primaryForeground }]}>{label}</Text></Pressable>);
  const Chip = ({ label, active, onPress, disabled }: { label: string; active: boolean; onPress: () => void; disabled?: boolean }) => (
    <Pressable onPress={onPress} disabled={disabled} style={[st.chip, { backgroundColor: active ? colors.primary : colors.background, borderColor: active ? colors.primary : colors.border, opacity: disabled ? 0.6 : 1 }]}>
      <Text style={[st.chipText, { color: active ? colors.primaryForeground : colors.mutedForeground }]}>{label}</Text></Pressable>);
  const Sw = ({ label, value, onChange, testID }: { label: string; value: boolean; onChange: (v: boolean) => void; testID?: string }) => (
    <View style={st.trow}><Text style={[st.small, { color: colors.foreground, flex: 1 }]}>{label}</Text><Switch value={value} onValueChange={onChange} testID={testID} /></View>);
  const Card = ({ children }: { children: React.ReactNode }) => <View style={[st.card, { backgroundColor: colors.card, borderColor: colors.border }]}>{children}</View>;
  const Errs = () => (error ? <Text style={{ color: colors.destructive, fontFamily: 'Inter_500Medium', fontSize: 13 }} testID="text-finance-error">{error}</Text> : null);
  const Save = ({ label, onPress }: { label: string; onPress: () => void }) => (
    <><Btn label={busy ? 'Saving…' : editing ? 'Save changes' : label} onPress={onPress} disabled={!sourcesReady} testID="button-save-finance" />{editing && <Btn label="Cancel" onPress={resetForms} outline testID="button-cancel-edit" />}</>);
  const Row = ({ r, children }: { r: SavedFinance; children: React.ReactNode }) => (
    <View style={[st.mov, { borderColor: colors.border, opacity: r.ledgerStatus === 'void' ? 0.6 : 1 }]} testID={`row-finance-${r.id}`}>
      {children}
      {r.ledgerStatus === 'void' ? <T>Void</T> : <>
        <View style={st.row}><Btn label="Edit" onPress={() => edit(r)} outline testID={`button-edit-${r.id}`} /><Btn label="Void" onPress={() => { setVoidId(voidId === r.id ? null : r.id); setVoidReason(''); setError(''); }} outline danger testID={`button-void-${r.id}`} /></View>
        {voidId === r.id && <View style={{ gap: 6 }}><TextInput style={inp()} value={voidReason} onChangeText={setVoidReason} placeholder="Reason for voiding (required)" placeholderTextColor={colors.mutedForeground} testID={`input-void-reason-${r.id}`} /><Btn label="Confirm void" onPress={() => void doVoid(r)} danger testID={`button-confirm-void-${r.id}`} /></View>}</>}
    </View>);
  const TI = (label: string, v: string, set: (t: string) => void, o?: { numeric?: boolean; id?: string; ph?: string }) => (
    <><L>{label}</L><TextInput style={inp()} value={v} onChangeText={set} keyboardType={o?.numeric ? 'numbers-and-punctuation' : 'default'} autoCapitalize="none" placeholder={o?.ph} placeholderTextColor={colors.mutedForeground} editable={!busy} testID={o?.id} /></>);

  // ---- assets
  const previewAsset = useMemo(() => { try { return buildAsset(af, entries); } catch { return null; } }, [af, entries]);
  const assets = records.filter(r => r.finance.kind === 'asset');
  const taxes = records.filter(r => r.finance.kind === 'tax');
  const stmts = records.filter(r => r.finance.kind === 'statement');

  const AssetsTab = () => (<>
    <Card>
      <Text style={[st.h2, { color: colors.foreground }]}>{editing ? 'Edit fixed asset' : 'Register a fixed asset'}</Text>
      <T>Straight-line, pro-rated by day within calendar months, never below residual value.</T>
      {TI('Asset name', af.name, t => setAf({ ...af, name: t }), { id: 'input-asset-name' })}
      {TI('Reference (invoice / receipt)', af.reference, t => setAf({ ...af, reference: t }), { id: 'input-asset-reference' })}
      {TI('Cost (₦)', af.cost, t => setAf({ ...af, cost: t }), { numeric: true, id: 'input-asset-cost' })}
      {TI('Residual value (₦)', af.residual, t => setAf({ ...af, residual: t }), { numeric: true, id: 'input-asset-residual' })}
      {TI('Useful life (months)', af.life, t => setAf({ ...af, life: t }), { numeric: true, id: 'input-asset-life' })}
      {TI('Acquisition date (YYYY-MM-DD)', af.date, t => setAf({ ...af, date: t, depStart: af.depStart < t ? t : af.depStart }), { id: 'input-asset-date' })}
      {TI('Depreciation starts (may be future)', af.depStart, t => setAf({ ...af, depStart: t }), { id: 'input-asset-depstart' })}
      <L>Linked equipment expense (avoids double payment)</L>
      <View style={st.row}>
        <Chip label="No link" active={!af.source} onPress={() => setAf({ ...af, source: '', mode: af.mode === 'non_cash' ? 'cash' : af.mode })} />
        {equipment.map(e => <Chip key={e.id} label={`${e.date} ${fmt(e.amount)}`} active={af.source === e.id} onPress={() => setAf({ ...af, source: e.id, mode: 'non_cash' })} />)}
      </View>
      {equipment.length === 0 && <T>No Equipment expenses found to link.</T>}
      <L>Paid from</L>
      <View style={st.row}>{(['cash', 'bank', 'non_cash'] as const).map(m => <Chip key={m} label={m === 'non_cash' ? 'Non-cash' : m === 'cash' ? 'Cash' : 'Bank'} active={(af.source ? 'non_cash' : af.mode) === m} disabled={!!af.source} onPress={() => setAf({ ...af, mode: m })} />)}</View>
      {af.mode === 'non_cash' && !af.source && <T style={{ color: colors.destructive }}>Non-cash assets bought after your opening date need a linked expense. Record the real funding first, or choose Cash/Bank.</T>}
      <Sw label="Asset has been disposed of" value={af.dispose} onChange={v => setAf({ ...af, dispose: v })} testID="checkbox-asset-dispose" />
      {af.dispose && <>
        {TI('Disposal date (YYYY-MM-DD)', af.dDate, t => setAf({ ...af, dDate: t }), { id: 'input-disposal-date' })}
        {TI('Proceeds (₦)', af.dProceeds, t => setAf({ ...af, dProceeds: t }), { numeric: true, id: 'input-disposal-proceeds' })}
        <View style={st.row}>{(['cash', 'bank'] as const).map(m => <Chip key={m} label={`Into ${m === 'cash' ? 'Cash' : 'Bank'}`} active={af.dAccount === m} onPress={() => setAf({ ...af, dAccount: m })} />)}</View></>}
      {TI('Notes', af.notes, t => setAf({ ...af, notes: t }))}
      {previewAsset && <View style={[st.totals, { backgroundColor: colors.muted }]} testID="panel-asset-preview">
        <View style={st.trow}><T>Accumulated depreciation to {today()}</T><Text style={[st.tval, { color: colors.foreground }]}>{fmt(accumulatedDepreciation(previewAsset, today()))}</Text></View>
        <View style={st.trow}><T>Carrying amount</T><Text style={[st.tval, { color: colors.foreground }]}>{fmt(assetCarrying(previewAsset, today()))}</Text></View></View>}
      <Errs /><Save label="Save asset" onPress={() => void submit(() => buildAsset(af, entries), 'Asset saved')} />
    </Card>
    <Card><Text style={[st.h2, { color: colors.foreground }]}>Asset register</Text>
      {assets.length === 0 ? <T>No fixed assets registered yet.</T> : assets.map(r => { const a = r.finance as AssetRecord; return (
        <Row key={r.id} r={r}><View style={st.trow}><Text style={[st.bold, { color: colors.foreground, flex: 1 }]}>{a.name}</Text><Text style={[st.bold, { color: colors.foreground }]}>{fmt(a.cost)}</Text></View>
          <T>Acquired {a.date} · {a.usefulLifeMonths} months · Ref {a.reference}{a.sourceEntryId ? ' · linked expense' : ` · paid ${a.paymentMode}`}</T>
          <T>Depreciation {fmt(accumulatedDepreciation(a, today()))} · Carrying {fmt(assetCarrying(a, today()))}</T>
          {a.disposalDate && <T>Disposed {a.disposalDate} for {fmt(a.disposalProceeds ?? 0)} into {a.disposalAccount}</T>}</Row>); })}
    </Card></>);

  const taxControl = sourcesReady ? buildTaxControlLedger(entries.map(e => ({ ...e, outputVAT: getEntryVAT(e) })), `${today().slice(0, 4)}-01-01`, today()).find(c => c.taxType === tf.taxType)! : null;
  const TaxesTab = () => (<>
    {taxControl && <Card>
      <Text style={[st.h2, { color: colors.foreground }]}>{TAXN[tf.taxType]} account</Text>
      {taxControlRows(taxControl, today()).map(row => <View key={row.label} style={st.trow}><T>{row.label}</T><Text style={[st.tval, { color: colors.foreground }]}>{row.value === null ? 'Not available' : fmt(row.value)}</Text></View>)}
      {taxControl.closing === null && <T>Confirm opening tax balances before using an outstanding balance.</T>}
      {!editing && taxControl.closing !== null && taxControl.closing > 0 && <Chip label="Use outstanding balance for payment" active={false} onPress={() => setTf({ ...emptyTax(), taxType: tf.taxType, action: 'payment', amount: String(taxControl.closing) })} />}
    </Card>}
    <Card>
      <Text style={[st.h2, { color: colors.foreground }]}>{editing ? 'Edit tax record' : 'Record tax charge, payment or credit'}</Text>
      <T>Recorded amounts from assessments and receipts, not estimates. Personal income tax estimates elsewhere are not filed liabilities.</T>
      <T>Sales VAT, input VAT and supplier WHT are included automatically. Record only additional assessed adjustments—not the same transaction tax again.</T>
      <View style={st.row}>{(['vat', 'wht', 'income_tax'] as const).map(k => <Chip key={k} label={TAXN[k]} active={tf.taxType === k} onPress={() => setTf({ ...tf, taxType: k })} />)}</View>
      <View style={st.row}>{(['charge', 'payment', 'credit'] as const).map(k => <Chip key={k} label={k[0]!.toUpperCase() + k.slice(1)} active={tf.action === k} onPress={() => setTf({ ...tf, action: k, source: k === 'payment' ? tf.source : '' })} />)}</View>
      {tf.action === 'payment' ? <View style={st.row}>{(['cash', 'bank'] as const).map(m => <Chip key={m} label={m === 'cash' ? 'Paid from Cash' : 'Paid from Bank'} active={tf.mode === m} onPress={() => setTf({ ...tf, mode: m })} />)}</View> : <T>Charges and credits are non-cash.</T>}
      {tf.action === 'payment' && <><L>Existing paid expense (optional)</L>
        <T>Select an existing tax-payment expense.</T>
        <View style={st.row}>
          <Chip label="No link" active={!tf.source} onPress={() => setTf({ ...tf, source: '' })} />
          {taxSources.map(e => <Chip key={e.id} label={`${e.date} ${fmt(e.amount)} ${String(getEntryPaymentMode(e))}`} active={tf.source === e.id} onPress={() => setTf({ ...tf, source: e.id, date: e.date, amount: String(e.amount) })} />)}
        </View></>}
      {TI('Amount (₦)', tf.amount, t => setTf({ ...tf, amount: t }), { numeric: true, id: 'input-tax-amount' })}
      {TI('Date (YYYY-MM-DD)', tf.date, t => setTf({ ...tf, date: t }), { id: 'input-tax-date' })}
      {TI('Assessment / receipt reference', tf.reference, t => setTf({ ...tf, reference: t }), { id: 'input-tax-reference' })}
      {TI('Notes', tf.notes, t => setTf({ ...tf, notes: t }))}
      <Sw label="I checked this amount against the assessment or receipt" value={tf.confirmed} onChange={v => setTf({ ...tf, confirmed: v })} testID="checkbox-tax-confirm" />
      <Errs /><Save label="Save tax record" onPress={() => void submit(() => buildTax(tf), 'Tax record saved')} />
    </Card>
    <Card><Text style={[st.h2, { color: colors.foreground }]}>Recorded taxes</Text>
      {taxes.length === 0 ? <T>No tax records yet.</T> : taxes.map(r => { const t = r.finance as TaxRecord; return (
        <Row key={r.id} r={r}><View style={st.trow}><Text style={[st.bold, { color: colors.foreground, flex: 1 }]}>{TAXN[t.taxType]} {t.action}</Text><Text style={[st.bold, { color: colors.foreground }]}>{fmt(t.amount)}</Text></View>
          <T>{t.date} · Ref {t.reference}{t.action === 'payment' ? ` · from ${t.paymentMode}` : ' · non-cash'}</T></Row>); })}
    </Card></>);

  // ---- working capital & loans (live from accountingLedger subscription)
  const opening = useMemo(() => (sourcesReady ? openingInfo(entries) : null), [entries, sourcesReady]);
  const workingList = useMemo(() => entries.filter(e => e.finance?.kind === 'working_capital').map(e => e as unknown as SavedFinance).sort((a, b) => String((b.finance as WorkingCapitalRecord).date).localeCompare(String((a.finance as WorkingCapitalRecord).date))), [entries]);
  const position = useMemo(() => (sourcesReady ? workingPosition(entries, today()) : null), [entries, sourcesReady]);
  const room = opening ? openingRoom(entries, opening.balances, editing ? editId : '') : null;
  const wOriginals = useMemo(() => originals(entries, wf.account, editing ? editId : ''), [entries, wf.account, editing, editId]);
  const liveEdited = editing && tab === 'working' ? entries.find(e => e.id === editId) : undefined;
  const staleEdit = !!liveEdited && (liveEdited.ledgerStatus === 'void' || (liveEdited.ledgerRevision ?? 0) !== editRev);
  const nameOf = (id: string) => { const w = entries.find(x => x.id === id)?.finance as WorkingCapitalRecord | undefined; return w ? `${w.partyName} · ${w.date} · ${fmt(w.amount)}` : 'Original not available'; };
  const saveWorking = async () => {
    if (staleEdit) { setError('This record changed in another session. Load the latest version before saving.'); return; }
    let preview: WorkingCapitalRecord;
    try { preview = buildWorking(wf, entries, opening, editing ? editId : ''); } catch (e) { setError(errText(e)); return; }
    if (!(await confirmAsync(editing ? 'Save changes?' : 'Save this record?', `${actionLabel(preview.account, preview.action)} · ${preview.partyName} · ${fmt(preview.amount)} on ${preview.date} · ${preview.paymentMode === 'non_cash' ? 'non-cash' : preview.paymentMode}`, 'Save'))) return;
    void submit(() => buildWorking(wf, entries, opening, editing ? editId : ''), editing ? 'Working capital record updated' : 'Working capital record saved');
  };
  const Seg2 = <V extends string>({ value, options, onChange, disabled }: { value: V; options: [V, string][]; onChange: (v: V) => void; disabled?: boolean }) =>
    <View style={st.row}>{options.map(([k, l]) => <Chip key={k} label={l} active={value === k} disabled={disabled} onPress={() => onChange(k)} />)}</View>;
  const WorkingTab = () => (<>
    <Card>
      <Text style={[st.h2, { color: colors.foreground }]}>Position today</Text>
      {!position ? <View style={{ height: 60, borderRadius: 8, backgroundColor: colors.muted }} /> :
        ([['Prepayments', position.prepayment], ['Accrued expenses', position.accrual], ['Unearned revenue', position.unearned_revenue], ['Loans due within 12 months', position.currentLoans], ['Loans due after 12 months', position.nonCurrentLoans]] as [string, number][]).map(([l, v]) =>
          <View key={l} style={st.trow}><T>{l}</T><Text style={[st.tval, { color: colors.foreground }]}>{fmt(v)}</Text></View>)}
      {opening ? <T>Opening date {opening.date}. Unclassified opening room: other current assets {fmt(room!.prepayment)}, other current liabilities {fmt(room!.accrualOrUnearned)}, loans {fmt(room!.loan)}.</T>
        : sourcesReady ? <><T style={{ color: colors.destructive }}>Confirm opening balances before managing these accounts.</T><Btn label="Go to opening balances" onPress={() => router.push('/equity')} outline /></> : null}
    </Card>
    <Card>
      <Text style={[st.h2, { color: colors.foreground }]}>{editing ? 'Edit working capital record' : 'Record a prepayment, accrual, advance or loan'}</Text>
      {staleEdit && <View style={{ gap: 6 }} testID="status-working-stale"><T style={{ color: colors.destructive }}>{liveEdited?.ledgerStatus === 'void' ? 'This record was voided in another session.' : 'This record changed in another session.'}</T>
        <View style={st.row}>{liveEdited?.ledgerStatus !== 'void' && <Btn label="Load latest" onPress={() => edit(liveEdited as unknown as SavedFinance)} outline testID="button-load-latest" />}<Btn label="Discard" onPress={resetForms} outline /></View></View>}
      <L>Account</L>
      <Seg2 value={wf.account} disabled={editing} onChange={v => setWf({ ...wf, account: v, action: wf.action === 'interest' && v !== 'loan' ? 'increase' : wf.action, linked: '' })} options={ACCOUNT_OPTIONS} />
      <L>Action</L>
      <Seg2 value={wf.action} onChange={v => setWf({ ...wf, action: v, linked: '' })} options={actionOptions(wf.account)} />
      <T>{effectText(wf.account, wf.action)}</T>
      {needsOriginal(wf.action) && <><L>Original record</L><T>Partial amounts are allowed; nothing is split automatically.</T>
        <View style={st.row}>{wOriginals.map(o => <Chip key={o.id} label={`${o.record.date} ${o.record.partyName} · left ${fmt(o.remaining)}`} active={wf.linked === o.id} onPress={() => setWf({ ...wf, linked: o.id, term: o.record.loanTerm, party: wf.party || o.record.partyName })} />)}</View>
        {wOriginals.length === 0 && <T style={{ color: colors.destructive }}>No active original for this account. Record the opening balance or increase first.</T>}</>}
      {TI(wf.account === 'loan' ? 'Lender' : wf.account === 'unearned_revenue' ? 'Customer' : 'Supplier / description', wf.party, t => setWf({ ...wf, party: t }), { id: 'input-working-party' })}
      {TI('Supporting reference (agreement, invoice, receipt)', wf.reference, t => setWf({ ...wf, reference: t }), { id: 'input-working-reference' })}
      {TI('Amount (₦)', wf.amount, t => setWf({ ...wf, amount: t }), { numeric: true, id: 'input-working-amount' })}
      {wf.action === 'opening' ? <T>Date: confirmed opening date {opening?.date ?? '(not confirmed)'}</T>
        : TI(`Date (YYYY-MM-DD)${opening ? `, after ${opening.date}` : ''}`, wf.date, t => setWf({ ...wf, date: t }), { id: 'input-working-date' })}
      {wf.account === 'loan' && <><L>Loan term</L><Seg2 value={wf.term} disabled={needsOriginal(wf.action)} onChange={v => setWf({ ...wf, term: v })} options={[['current', 'Within 12 months'], ['non_current', 'After 12 months']]} /></>}
      {isMoney(wf) ? <Seg2 value={wf.mode} onChange={v => setWf({ ...wf, mode: v })} options={[['cash', 'Cash'], ['bank', 'Bank']]} /> : <T>Non-cash. Cash and Bank do not move.</T>}
      {TI('Notes', wf.notes, t => setWf({ ...wf, notes: t }))}
      <Sw label="I checked this amount, date and treatment against the supporting document" value={wf.confirmed} onChange={v => setWf({ ...wf, confirmed: v })} testID="checkbox-working-confirm" />
      <Errs /><Save label="Save record" onPress={() => void saveWorking()} />
    </Card>
    <Card><Text style={[st.h2, { color: colors.foreground }]}>Working capital and loans register</Text>
      {!sourcesReady ? <View style={{ height: 60, borderRadius: 8, backgroundColor: colors.muted }} />
        : workingList.length === 0 ? <T>No prepayments, accruals, advances or loans recorded. Classify your opening balances first, then record new movements.</T>
        : workingList.map(r => { const w = r.finance as WorkingCapitalRecord; const root = w.action === 'opening' || w.action === 'increase'; return (
          <Row key={r.id} r={r}><View style={st.trow}><Text style={[st.bold, { color: colors.foreground, flex: 1 }]}>{w.partyName} · {actionLabel(w.account, w.action)}</Text><Text style={[st.bold, { color: colors.foreground }]}>{fmt(w.amount)}</Text></View>
            <T>{w.date} · {ACCOUNT_OPTIONS.find(a => a[0] === w.account)?.[1]}{w.account === 'loan' ? ` · ${w.loanTerm === 'current' ? 'current' : 'non-current'}` : ''} · Ref {w.reference} · {w.paymentMode === 'non_cash' ? 'non-cash' : w.paymentMode}</T>
            {!!w.linkedRecordId && <T>Against {nameOf(w.linkedRecordId)}</T>}
            {root && r.ledgerStatus !== 'void' && <T>Remaining {fmt(workingBalance(entries, r.id))}</T>}</Row>); })}
    </Card></>);

  // ---- statements
  const colN = (v: string) => (v.trim() === '' ? undefined : Number(v));
  const columns = (): StatementColumns => ({ date: Number(cols.date), description: Number(cols.description), dateFormat: cols.fmt, reference: colN(cols.reference),
    ...(cols.mode === 'signed' ? { amount: Number(cols.amount) } : { debit: Number(cols.debit), credit: Number(cols.credit) }) });
  const readCsv = () => { try { setTable(parseCSV(csvText)); setExcluded(new Set()); setMapErrors([]); setError(''); } catch (e) { setError(errText(e)); } };
  const pickStatement=async()=>{
    if(busyRef.current||!uid)return;
    const owner=uid;busyRef.current=true;setBusy(true);setError('');setImportWarnings([]);
    let temporaryUri:string|undefined;
    try{
      const selection=await DocumentPicker.getDocumentAsync({type:'*/*',copyToCacheDirectory:true,multiple:false});
      if(selection.canceled||latestUid.current!==owner)return;
      const file=selection.assets[0]!;
      if(!/\.(csv|pdf)$/i.test(file.name)||(file.size??0)>5*1024*1024)throw new Error('Choose a CSV or PDF up to 5 MiB.');
      let content:string;
      if(Platform.OS==='web'&&file.file){
        content=await new Promise<string>((resolve,reject)=>{
          const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]??'');
          reader.onerror=()=>reject(new Error('Could not read the selected statement.'));reader.readAsDataURL(file.file!);
        });
      }else{
        temporaryUri=FileSystem.cacheDirectory&&file.uri.startsWith(FileSystem.cacheDirectory)?file.uri:undefined;
        content=await FileSystem.readAsStringAsync(file.uri,{encoding:FileSystem.EncodingType.Base64});
      }
      if(content.length>6990508)throw new Error('Choose a statement up to 5 MiB.');
      if(latestUid.current!==owner)return;
      const extracted=await extractStatement(file.name,content);
      if(latestUid.current!==owner)return;
      setTable(extracted.table);setExcluded(new Set());setMapErrors([]);setImportWarnings(extracted.warnings);
    }catch(e){if(latestUid.current===owner)setError(errText(e));}
    finally{
      if(temporaryUri)await FileSystem.deleteAsync(temporaryUri,{idempotent:true}).catch(()=>{});
      if(latestUid.current===owner){busyRef.current=false;setBusy(false);}
    }
  };
  const applyMapping = () => { const res = mapTable(table, excluded, columns()); setMapErrors(res.errors); if (res.errors.length === 0) { setRows(res.rows); setError(''); } else setError(`${res.errors.length} row(s) need review. Fix the mapping or exclude them explicitly.`); };
  const upRow = (id: string, p: Partial<DraftRow>) => setRows(rs => rs.map(r => r.id === id ? { ...r, ...p } : r));
  const diff = statementDiff(sf, rows);
  const claimed = new Map(rows.filter(r => r.matchedEntryId).map(r => [r.matchedEntryId, r.id]));
  const draft = useMemo<StatementRecord | null>(() => {
    if (!sf.start || !sf.end || rows.length === 0) return null;
    return { kind: 'statement', bankName: sf.bankName, accountLabel: sf.accountLabel, startDate: sf.start, endDate: sf.end, openingBalance: num(sf.opening), closingBalance: num(sf.closing),
      rows: rows.map(r => ({ id: r.id, date: r.date, description: r.description, amount: num(r.amount), reference: r.reference, ...(r.matchedEntryId ? { matchedEntryId: r.matchedEntryId } : {}) })),
      outstandingEntryIds: outstanding, completeBankCoverage: sf.coverage, reference: sf.reference, notes: sf.notes };
  }, [sf, rows, outstanding]);
  const bookClose = (end: string) => (sourcesReady && end ? calcMoneyAccountBalances(entries, end).bank : 0);
  const draftRec = useMemo(() => {
    if (!draft || !sourcesReady) return null;
    const others = activeStatements(records).filter(r => r.id !== editId).map(r => r.finance as StatementRecord).filter(s => groupKey(s) === groupKey(draft));
    return reconcileGroup([...others, draft], movements, bookClose(draft.endDate));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, records, editId, movements, sourcesReady]);
  const unmatchedBooks = draft ? movements.filter(m => m.date >= sf.start && m.date <= sf.end && !claimed.has(m.id)) : [];
  const groups = useMemo(() => { const g = new Map<string, StatementRecord[]>(); for (const r of activeStatements(records)) { const s = r.finance as StatementRecord; g.set(groupKey(s), [...(g.get(groupKey(s)) ?? []), s]); } return [...g.entries()].sort((a, b) => b[0].localeCompare(a[0])); }, [records]);
  const suggest = () => setRows(rs => { const used = new Set(rs.map(r => r.matchedEntryId).filter(Boolean)); return rs.map(r => {
    if (r.matchedEntryId) return r;
    const c = movements.filter(m => !used.has(m.id) && Math.round(m.amount * 100) === Math.round(num(r.amount) * 100) && m.date === r.date);
    if (c.length === 1) { used.add(c[0]!.id); return { ...r, matchedEntryId: c[0]!.id }; } return r; }); });

  const Recon = ({ rec, title }: { rec: ReturnType<typeof reconcileGroup>; title: string }) => (
    <View style={[st.totals, { backgroundColor: colors.muted, borderWidth: 1, borderColor: rec.reconciled ? colors.primary : colors.border }]} testID="panel-reconciliation">
      <Text style={[st.bold, { color: colors.foreground }]}>{title}</Text>
      <Text style={[st.bold, { color: rec.reconciled ? colors.primary : colors.destructive }]}>{rec.reconciled ? 'Reconciled' : 'Not reconciled'}</Text>
      {([['Statement closing (combined)', fmt(rec.statementClosing)], ['Book Bank closing', fmt(rec.bookClosing)], ['Outstanding (net)', fmt(rec.outstandingAmount)], ['Variance', fmt(rec.variance)], ['Unmatched statement rows', String(rec.unmatchedRows)], ['Unmatched book movements', String(rec.unmatchedBooks)], ['Stale matches', String(rec.stale)]] as [string, string][]).map(([l, v]) => (
        <View key={l} style={st.trow}><T>{l}</T><Text style={[st.tval, { color: colors.foreground }]}>{v}</Text></View>))}
    </View>);

  const StatementsTab = () => (<>
    <Card>
      <Text style={[st.h2, { color: colors.foreground }]}>Import a bank statement</Text>
      <T>CSV and PDF statements from any Nigerian bank. Importing never posts sales, expenses or purchases. Review every row; scanned or unusual PDFs may need manual entry or a CSV export. Raw files are not saved to your cloud records.</T>
      <Btn label={busy?'Reading statement…':'Choose CSV / PDF statement'} onPress={()=>void pickStatement()} outline testID="button-upload-statement" />
      {importWarnings.map((warning,index)=><T key={index}>{warning}</T>)}
      <TextInput style={inp({ height: 100, textAlignVertical: 'top' })} multiline value={csvText} onChangeText={setCsvText} placeholder="Paste CSV statement text" placeholderTextColor={colors.mutedForeground} testID="input-csv-text" />
      <Btn label="Read pasted CSV" onPress={readCsv} disabled={!csvText.trim()} outline testID="button-read-csv" />
      {table.length > 0 && <>
        {TI('Date column # (from 0)', cols.date, t => setCols({ ...cols, date: t }), { numeric: true })}
        {TI('Description column #', cols.description, t => setCols({ ...cols, description: t }), { numeric: true })}
        {TI('Reference column # (optional)', cols.reference, t => setCols({ ...cols, reference: t }), { numeric: true })}
        <View style={st.row}><Chip label="Day/Month" active={cols.fmt === 'DMY'} onPress={() => setCols({ ...cols, fmt: 'DMY' })} /><Chip label="Month/Day" active={cols.fmt === 'MDY'} onPress={() => setCols({ ...cols, fmt: 'MDY' })} /></View>
        <View style={st.row}><Chip label="Signed amount" active={cols.mode === 'signed'} onPress={() => setCols({ ...cols, mode: 'signed' })} /><Chip label="Debit / credit" active={cols.mode === 'split'} onPress={() => setCols({ ...cols, mode: 'split' })} /></View>
        {cols.mode === 'signed' ? TI('Amount column #', cols.amount, t => setCols({ ...cols, amount: t }), { numeric: true }) : <>{TI('Debit column #', cols.debit, t => setCols({ ...cols, debit: t }), { numeric: true })}{TI('Credit column #', cols.credit, t => setCols({ ...cols, credit: t }), { numeric: true })}</>}
        <T>Switch on Exclude for headers and non-transaction rows. Nothing is dropped silently.</T>
        {table.map((cells, i) => { const err = mapErrors.find(x => x.index === i); return (
          <View key={i} style={[st.mov, { borderColor: err ? colors.destructive : colors.border, opacity: excluded.has(i) ? 0.45 : 1 }]}>
            <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: 'Inter_400Regular' }} numberOfLines={2}>{i}: {cells.join(' | ')}</Text>
            {err && <T style={{ color: colors.destructive }}>{err.message}</T>}
            <Sw label="Exclude this row" value={excluded.has(i)} onChange={v => setExcluded(s => { const n = new Set(s); if (v) n.add(i); else n.delete(i); return n; })} testID={`checkbox-exclude-${i}`} /></View>); })}
        <Btn label={`Map ${table.length - excluded.size} rows`} onPress={applyMapping} testID="button-apply-mapping" />
      </>}
    </Card>
    <Card>
      <Text style={[st.h2, { color: colors.foreground }]}>{editing ? 'Edit statement' : 'Statement review'}</Text>
      {TI('Bank name', sf.bankName, t => setSf({ ...sf, bankName: t }), { id: 'input-bank-name' })}
      {TI('Account label (e.g. Current ending 4821)', sf.accountLabel, t => setSf({ ...sf, accountLabel: t }), { id: 'input-account-label' })}
      {TI('Period start (YYYY-MM-DD)', sf.start, t => setSf({ ...sf, start: t }), { id: 'input-stmt-start' })}
      {TI('Period end (YYYY-MM-DD)', sf.end, t => setSf({ ...sf, end: t }), { id: 'input-stmt-end' })}
      {TI('Opening balance (₦)', sf.opening, t => setSf({ ...sf, opening: t }), { numeric: true, id: 'input-stmt-opening' })}
      {TI('Closing balance (₦)', sf.closing, t => setSf({ ...sf, closing: t }), { numeric: true, id: 'input-stmt-closing' })}
      {TI('Reference', sf.reference, t => setSf({ ...sf, reference: t }), { id: 'input-stmt-reference' })}
      {TI('Notes', sf.notes, t => setSf({ ...sf, notes: t }))}
      <View style={st.trow}><Text style={[st.h2, { color: colors.foreground }]}>Rows ({rows.length})</Text>
        <View style={st.row}><Pressable onPress={suggest} testID="button-suggest"><Text style={{ color: colors.primary, fontFamily: 'Inter_700Bold', fontSize: 13 }}>Suggest matches</Text></Pressable>
          <Pressable onPress={() => setRows(rs => [...rs, { id: `manual_${Date.now().toString(36)}${rs.length}`, date: sf.start || today(), description: '', amount: '', reference: '', matchedEntryId: '' }])} testID="button-add-row"><Text style={{ color: colors.primary, fontFamily: 'Inter_700Bold', fontSize: 13 }}>Add row</Text></Pressable></View></View>
      {rows.length === 0 && <T>No rows yet. Map a CSV or add rows by hand. Positive = money in, negative = money out.</T>}
      {rows.map(r => {
        const cands = movements.filter(m => Math.round(m.amount * 100) === Math.round(num(r.amount) * 100) && (!claimed.has(m.id) || claimed.get(m.id) === r.id));
        const cur = movements.find(m => m.id === r.matchedEntryId);
        return (<View key={r.id} style={[st.mov, { borderColor: colors.border }]} testID={`row-stmt-${r.id}`}>
          <TextInput style={inp()} value={r.date} onChangeText={t => upRow(r.id, { date: t })} placeholder="YYYY-MM-DD" placeholderTextColor={colors.mutedForeground} autoCapitalize="none" />
          <TextInput style={inp()} value={r.description} onChangeText={t => upRow(r.id, { description: t })} placeholder="Description" placeholderTextColor={colors.mutedForeground} />
          <TextInput style={inp()} value={r.amount} onChangeText={t => upRow(r.id, { amount: t, matchedEntryId: '' })} keyboardType="numbers-and-punctuation" placeholder="Amount (+/-)" placeholderTextColor={colors.mutedForeground} />
          <T>{r.matchedEntryId ? (cur ? `Matched: ${cur.date} ${cur.description}` : 'Stale match (book record changed)') : 'Unmatched'}</T>
          <View style={st.row}>
            <Btn label={pickRow === r.id ? 'Close' : 'Match'} onPress={() => setPickRow(pickRow === r.id ? null : r.id)} outline />
            {!!r.matchedEntryId && <Btn label="Unmatch" onPress={() => upRow(r.id, { matchedEntryId: '' })} outline />}
            <Btn label="Exclude row" onPress={() => setRows(rs => rs.filter(x => x.id !== r.id))} outline danger testID={`button-remove-row-${r.id}`} /></View>
          {pickRow === r.id && (cands.length === 0 ? <T>No equal-amount Bank movement available.</T> : cands.map(m => <Chip key={m.id} label={`${m.date} ${m.description} ${fmt(m.amount)}`} active={r.matchedEntryId === m.id} onPress={() => { upRow(r.id, { matchedEntryId: m.id }); setPickRow(null); }} />))}
        </View>);
      })}
      {draft && <>
        <Text style={[st.h2, { color: colors.foreground }]}>Unmatched book movements ({unmatchedBooks.length})</Text>
        <T>Switch on items already in your books but not yet cleared by the bank. You choose each one.</T>
        {unmatchedBooks.map(m => <Sw key={m.id} label={`${m.date} · ${m.description} · ${fmt(m.amount)}`} value={outstanding.includes(m.id)} onChange={v => setOutstanding(o => v ? [...o, m.id] : o.filter(x => x !== m.id))} testID={`checkbox-outstanding-${m.id}`} />)}
      </>}
      <View style={[st.totals, { backgroundColor: colors.muted }]} testID="panel-stmt-summary">
        <View style={st.trow}><T>Money in</T><Text style={[st.tval, { color: colors.foreground }]}>{fmt(rows.reduce((s, r) => s + Math.max(0, num(r.amount) || 0), 0))}</Text></View>
        <View style={st.trow}><T>Money out</T><Text style={[st.tval, { color: colors.foreground }]}>{fmt(rows.reduce((s, r) => s + Math.min(0, num(r.amount) || 0), 0))}</Text></View>
        <View style={st.trow}><T>Opening + rows − closing</T><Text style={[st.tval, { color: diff === 0 ? colors.primary : colors.destructive }]}>{Number.isNaN(diff) ? 'Incomplete' : fmt(diff)}</Text></View>
        <T>{diff === 0 ? 'Statement balances.' : 'Must be zero. Look for missing, duplicate or mis-signed rows.'}</T></View>
      <Sw label="This statement set covers every Bank account in my books for this period" value={sf.coverage} onChange={v => setSf({ ...sf, coverage: v })} testID="checkbox-coverage" />
      {draftRec && <Recon rec={draftRec} title="Preview with saved statements of the same period" />}
      <Errs /><Save label="Save statement" onPress={() => void submit(() => buildStatement(sf, rows, outstanding), 'Statement saved')} />
    </Card>
    <Card><Text style={[st.h2, { color: colors.foreground }]}>Reconciliation by period</Text>
      {groups.length === 0 ? <T>No saved statements. Same-period accounts are combined against your total Bank balance.</T> :
        groups.map(([k, g]) => <Recon key={k} rec={reconcileGroup(g, movements, bookClose(g[0]!.endDate))} title={`${g[0]!.startDate} to ${g[0]!.endDate} · ${g.map(s => `${s.bankName} ${s.accountLabel}`).join(', ')}`} />)}</Card>
    <Card><Text style={[st.h2, { color: colors.foreground }]}>Statement history</Text>
      {stmts.length === 0 ? <T>Nothing saved yet.</T> : stmts.map(r => { const s = r.finance as StatementRecord; return (
        <Row key={r.id} r={r}><View style={st.trow}><Text style={[st.bold, { color: colors.foreground, flex: 1 }]}>{s.bankName} · {s.accountLabel}</Text><Text style={[st.bold, { color: colors.foreground }]}>{fmt(s.closingBalance)}</Text></View>
          <T>{s.startDate} to {s.endDate} · {s.rows.length} rows · Ref {s.reference}</T></Row>); })}</Card></>);

  return (
    <View style={[st.container, { backgroundColor: colors.background }]}>
      <View style={[st.header, { backgroundColor: colors.card, paddingTop: topInset + 8, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} testID="button-back-finance"><ArrowLeft size={22} color={colors.foreground} /></Pressable>
        <Text style={[st.title, { color: colors.foreground }]} numberOfLines={1}>Financial Controls</Text>
        <Pressable onPress={() => router.push('/equity')} testID="link-equity"><Text style={{ color: colors.primary, fontFamily: 'Inter_600SemiBold', fontSize: 13 }}>Equity</Text></Pressable>
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: bottomInset + 40, gap: 14 }} keyboardShouldPersistTaps="handled">
          {!uid ? <Text style={{ color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }}>Sign in to manage financial controls.</Text> : <>
            <View style={st.row}>{(Object.keys(TABN) as Tab[]).map(t => <Chip key={t} label={TABN[t]} active={tab === t} onPress={() => { if (t !== tab) { resetForms(); setTab(t); } }} />)}</View>
            {!sourcesReady && <View style={[st.card, { backgroundColor: colors.card, borderColor: colors.destructive }]} testID="status-sources">
              <T>{eError ? `Could not load your records: ${eError}` : 'Loading your ledger. Saving and matching are disabled until it loads.'}</T>
              {!!eError && <Btn label="Retry" onPress={retry} testID="button-retry-sources" />}</View>}
            {loading ? <View style={{ gap: 12 }}>{[0, 1, 2].map(i => <View key={i} style={{ height: 90, borderRadius: 12, backgroundColor: colors.muted }} />)}</View>
              : loadError ? <View style={[st.card, { backgroundColor: colors.card, borderColor: colors.destructive }]}><Text style={{ color: colors.destructive, fontFamily: 'Inter_600SemiBold' }}>{loadError}</Text><Btn label="Retry" onPress={() => void load()} testID="button-retry-finance" /></View>
              : tab === 'returns' ? <ReturnCreditReview /> : tab === 'assets' ? AssetsTab() : tab === 'taxes' ? TaxesTab() : tab === 'working' ? WorkingTab() : StatementsTab()}
            {!!lastResult && <Text style={{ color: colors.primary, fontFamily: 'Inter_500Medium', fontSize: 12 }} testID="text-finance-result">{lastResult}</Text>}
            {busy && <ActivityIndicator color={colors.primary} />}
          </>}
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
  bold: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  small: { fontSize: 12, lineHeight: 17, fontFamily: 'Inter_400Regular' },
  label: { fontSize: 13, fontFamily: 'Inter_600SemiBold', marginTop: 4 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, height: 46, fontSize: 15, fontFamily: 'Inter_400Regular' },
  btn: { height: 46, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, flexGrow: 1 },
  btnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  chipText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  trow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  totals: { borderRadius: 10, padding: 12, gap: 6 },
  tval: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  mov: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 10, gap: 6 },
});
