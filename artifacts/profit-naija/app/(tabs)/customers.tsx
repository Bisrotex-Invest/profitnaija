/**
 * Customers tab — add and view customer profiles.
 */
import React, { useState, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import {
  Users, Plus, Phone, MapPin,
  User, X, ChevronRight, Check, Camera, Mail,
  MessageSquare, MessageCircle
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Linking } from 'react-native';
import { useEntries, Entry } from '@/context/EntriesContext';
import { normalizeNigerianPhone } from '@/lib/utils/party';
import { pickPhotoAsDataUri } from '@/lib/utils/photo';
import { useColors } from '@/hooks/useColors';
import { useCustomers, Customer } from '@/context/CustomerContext';

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name: string): string {
  return name.trim().split(' ').slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase() || '?';
}

function avatarColor(name: string): string {
  const COLORS = ['#6366F1', '#EC4899', '#14B8A6', '#F59E0B', '#8B5CF6', '#10B981', '#3B82F6', '#EF4444'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return COLORS[h % COLORS.length];
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyCustomers({ colors }: { colors: any }) {
  return (
    <View style={eStyles.wrap}>
      <View style={[eStyles.icon, { backgroundColor: colors.primary + '18' }]}>
        <Users size={40} color={colors.primary} strokeWidth={1.5} />
      </View>
      <Text style={[eStyles.title, { color: colors.foreground }]}>No customers yet</Text>
      <Text style={[eStyles.sub, { color: colors.mutedForeground }]}>
        Tap the + button to add your first customer profile.
      </Text>
    </View>
  );
}

// ── Transaction Row ───────────────────────────────────────────────────────────

function TransactionRow({ entry, colors }: { entry: Entry; colors: any }) {
  const isPayment = entry.type === 'credit_sale_payment';
  const isCredit = entry.type === 'credit_sale';

  const typeLabel = isPayment ? 'Debtors Payment' : isCredit ? 'Debtors' : 'Sale';
  const typeColor = isPayment ? colors.primary : isCredit ? '#F59E0B' : '#10B981';

  return (
    <View style={[tStyles.row, { borderColor: colors.border }]}>
      <View style={tStyles.left}>
        <Text style={[tStyles.item, { color: colors.foreground }]} numberOfLines={1}>
          {entry.itemName || entry.category || typeLabel}
        </Text>
        <View style={tStyles.meta}>
          <Text style={[tStyles.date, { color: colors.mutedForeground }]}>{entry.date}</Text>
          <View style={tStyles.dot} />
          <Text style={[tStyles.type, { color: typeColor }]}>{typeLabel}</Text>
        </View>
      </View>
      <Text style={[tStyles.amount, { color: colors.foreground }]}>
        ₦{entry.amount.toLocaleString('en-NG')}
      </Text>
    </View>
  );
}

// ── Customer row ──────────────────────────────────────────────────────────────

function CustomerRow({
  customer, onPress, colors,
}: { customer: Customer; onPress: () => void; colors: any }) {
  const color = avatarColor(customer.fullName);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [cStyles.row, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.8 : 1 }]}
    >
      {/* Avatar */}
      <View style={[cStyles.avatar, { backgroundColor: color + '22', borderColor: color + '44' }]}>
        {customer.photoUri ? (
          <Image source={{ uri: customer.photoUri }} style={cStyles.avatarImg} />
        ) : (
          <Text style={[cStyles.avatarText, { color }]}>{initials(customer.fullName)}</Text>
        )}
      </View>
      {/* Info */}
      <View style={cStyles.info}>
        <Text style={[cStyles.name, { color: colors.foreground }]} numberOfLines={1}>
          {customer.fullName || 'Unnamed Customer'}
        </Text>
        {!!customer.phone && (
          <View style={cStyles.phoneRow}>
            <Phone size={11} color={colors.mutedForeground} />
            <Text style={[cStyles.phoneText, { color: colors.mutedForeground }]}>{customer.phone}</Text>
          </View>
        )}
      </View>
      <ChevronRight size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}

// ── Field ─────────────────────────────────────────────────────────────────────

function Field({
  label, value, onChangeText, placeholder, Icon, keyboardType, multiline, editable = true,
}: {
  label: string; value: string; onChangeText: (t: string) => void;
  placeholder: string; Icon: any; keyboardType?: any;
  multiline?: boolean; editable?: boolean;
}) {
  const colors = useColors();
  return (
    <View style={fieldStyles.group}>
      <Text style={[fieldStyles.label, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={[
        fieldStyles.row,
        {
          borderColor: colors.input,
          backgroundColor: colors.background,
          minHeight: multiline ? 72 : 48,
          alignItems: multiline ? 'flex-start' : 'center',
          paddingTop: multiline ? 12 : 0,
        },
      ]}>
        <View style={{ marginRight: 10, paddingTop: multiline ? 2 : 0 }}>
          <Icon size={16} color={colors.mutedForeground} />
        </View>
        <TextInput
          style={[fieldStyles.input, { color: colors.foreground }]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedForeground}
          keyboardType={keyboardType}
          autoCapitalize={keyboardType === 'phone-pad' ? 'none' : 'words'}
          multiline={multiline}
          textAlignVertical={multiline ? 'top' : 'center'}
          editable={editable}
        />
      </View>
    </View>
  );
}

// ── Add / View Modal ──────────────────────────────────────────────────────────

type FormState = Omit<Customer, 'id' | 'createdAt'>;
const EMPTY_FORM: FormState = {
  fullName: '', phone: '', email: '', homeAddress: '',
  businessName: '', businessAddress: '', businessPhone: '', photoUri: '',
};

function CustomerModal({
  visible, customer, onClose,
}: { visible: boolean; customer: Customer | null; onClose: () => void }) {
  const colors  = useColors();
  const insets  = useSafeAreaInsets();
  const { addCustomer, updateCustomer } = useCustomers();
  const { entries } = useEntries();

  const [form, setForm]       = useState<FormState>(customer ? { ...customer } : { ...EMPTY_FORM });
  const [saving, setSaving]   = useState(false);
  const [editing, setEditing] = useState(!customer); // new = edit mode, existing = view mode

  // Reset form when customer changes
  React.useEffect(() => {
    setForm(customer ? { ...customer } : { ...EMPTY_FORM });
    setEditing(!customer);
  }, [customer]);

  const field = (key: keyof FormState) => (v: string) => setForm(f => ({ ...f, [key]: v }));

  const handlePickPhoto = async () => {
    if (!editing) return;
    // Data URI — small enough for Firestore and works on every device.
    const uri = await pickPhotoAsDataUri();
    if (uri) setForm(f => ({ ...f, photoUri: uri }));
  };

  const handleSave = async () => {
    if (!form.fullName.trim()) return;
    setSaving(true);
    try {
      if (customer) {
        await updateCustomer(customer.id, form);
      } else {
        await addCustomer(form);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSaving(false);
    }
  };

  const customerEntries = React.useMemo(() => {
    if (!customer) return [];
    const normalizedCustPhone = normalizeNigerianPhone(customer.phone);

    return entries.filter(e => {
      if (e.type !== 'sale' && e.type !== 'credit_sale' && e.type !== 'credit_sale_payment') return false;

      if (e.customerId === customer.id) return true;
      if (normalizedCustPhone && e.partyPhone) {
        return normalizeNigerianPhone(e.partyPhone) === normalizedCustPhone;
      }
      return false;
    }).sort((a, b) => b.createdAt - a.createdAt);
  }, [entries, customer]);

  const handleCall = () => {
    if (customer?.phone) Linking.openURL(`tel:${customer.phone}`);
  };

  const handleSMS = () => {
    if (customer?.phone) Linking.openURL(`sms:${customer.phone}`);
  };

  const handleWhatsApp = () => {
    if (customer?.phone) {
      const waPhone = normalizeNigerianPhone(customer.phone);
      Linking.openURL(`https://wa.me/${waPhone}`);
    }
  };

  const handleEmail = () => {
    if (customer?.email) Linking.openURL(`mailto:${customer.email}`);
  };

  const color = avatarColor(form.fullName || '?');

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[mStyles.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[mStyles.header, { backgroundColor: colors.card, borderBottomColor: colors.border, paddingTop: insets.top + 12 }]}>
          <Pressable onPress={onClose} style={mStyles.closeBtn}>
            <X size={22} color={colors.mutedForeground} />
          </Pressable>
          <Text style={[mStyles.title, { color: colors.foreground }]}>
            {customer ? (editing ? 'Edit Customer' : 'Customer Profile') : 'New Customer'}
          </Text>
          {customer && !editing ? (
            <Pressable onPress={() => setEditing(true)} style={mStyles.editBtn}>
              <Text style={[mStyles.editText, { color: colors.primary }]}>Edit</Text>
            </Pressable>
          ) : (
            <View style={mStyles.editBtn} />
          )}
        </View>

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={[mStyles.scroll, { paddingBottom: insets.bottom + 32 }]} keyboardShouldPersistTaps="handled">

            {/* Avatar + Name — tap the photo to change it while editing */}
            <Animated.View entering={FadeInDown.springify()} style={mStyles.avatarSection}>
              <Pressable onPress={handlePickPhoto} disabled={!editing} style={mStyles.avatarWrap}>
                <View style={[mStyles.avatar, { backgroundColor: color + '22', borderColor: color + '44' }]}>
                  {form.photoUri ? (
                    <Image source={{ uri: form.photoUri }} style={mStyles.avatarImg} />
                  ) : (
                    <Text style={[mStyles.avatarText, { color }]}>{initials(form.fullName || '?')}</Text>
                  )}
                </View>
                {editing && (
                  <View style={[mStyles.cameraBadge, { backgroundColor: colors.primary }]}>
                    <Camera size={12} color="#fff" strokeWidth={2.5} />
                  </View>
                )}
              </Pressable>
              <View style={mStyles.avatarMeta}>
                <Text style={[mStyles.avatarName, { color: colors.foreground }]} numberOfLines={1}>
                  {form.fullName || 'Full Name'}
                </Text>
                {editing ? (
                  <Text style={[mStyles.tapHint, { color: colors.mutedForeground }]}>
                    Tap photo to {form.photoUri ? 'change' : 'add'}
                  </Text>
                ) : (
                  <Text style={[mStyles.tapHint, { color: colors.mutedForeground }]}>
                    {form.phone || form.email || 'No contact info'}
                  </Text>
                )}
              </View>
            </Animated.View>

            {/* Contact Actions (View Mode Only) */}
            {!editing && customer && (
              <Animated.View entering={FadeInDown.delay(30).springify()} style={mStyles.actionsRow}>
                {!!customer.phone && (
                  <>
                    <Pressable onPress={handleCall} style={[mStyles.actionBtn, { backgroundColor: colors.primary + '18' }]}>
                      <Phone size={18} color={colors.primary} />
                    </Pressable>
                    <Pressable onPress={handleSMS} style={[mStyles.actionBtn, { backgroundColor: colors.primary + '18' }]}>
                      <MessageSquare size={18} color={colors.primary} />
                    </Pressable>
                    <Pressable onPress={handleWhatsApp} style={[mStyles.actionBtn, { backgroundColor: '#25D366' + '22' }]}>
                      <MessageCircle size={18} color="#25D366" />
                    </Pressable>
                  </>
                )}
                {!!customer.email && (
                  <Pressable onPress={handleEmail} style={[mStyles.actionBtn, { backgroundColor: colors.primary + '18' }]}>
                    <Mail size={18} color={colors.primary} />
                  </Pressable>
                )}
              </Animated.View>
            )}

            {/* Personal */}
            {editing && (
              <Animated.View entering={FadeInDown.delay(60).springify()} style={[mStyles.section, { backgroundColor: colors.card }]}>
                <Text style={[mStyles.sectionTitle, { color: colors.primary }]}>Personal Information</Text>
                <Field label="Full Name"     value={form.fullName}     onChangeText={field('fullName')}     placeholder="Customer's full name" Icon={User}   editable={editing} />
                <Field label="Phone Number"  value={form.phone}        onChangeText={field('phone')}        placeholder="080XXXXXXXX"          Icon={Phone}  keyboardType="phone-pad" editable={editing} />
                <Field label="Email"         value={form.email ?? ''}  onChangeText={field('email')}         placeholder="customer@example.com" Icon={Mail} keyboardType="email-address" editable={editing} />
                <Field label="Home Address"  value={form.homeAddress}  onChangeText={field('homeAddress')}  placeholder="Street, City, State"  Icon={MapPin} multiline editable={editing} />
              </Animated.View>
            )}

            {/* Profile Info (View Mode) */}
            {!editing && customer && (
              <Animated.View entering={FadeInDown.delay(60).springify()} style={[mStyles.section, { backgroundColor: colors.card }]}>
                <Text style={[mStyles.sectionTitle, { color: colors.primary }]}>Details</Text>
                {!!customer.homeAddress && (
                  <View style={mStyles.detailRow}>
                    <MapPin size={16} color={colors.mutedForeground} />
                    <Text style={[mStyles.detailText, { color: colors.foreground }]}>{customer.homeAddress}</Text>
                  </View>
                )}
                {!customer.homeAddress && !customer.phone && !customer.email && (
                  <Text style={[mStyles.detailText, { color: colors.mutedForeground, paddingVertical: 8 }]}>No extra details provided.</Text>
                )}
              </Animated.View>
            )}

            {/* Transaction History (View Mode) */}
            {!editing && customer && (
              <Animated.View entering={FadeInDown.delay(90).springify()} style={[mStyles.section, { backgroundColor: colors.card }]}>
                <Text style={[mStyles.sectionTitle, { color: colors.primary }]}>Transaction History</Text>
                {customerEntries.length === 0 ? (
                  <View style={{ paddingVertical: 20, alignItems: 'center' }}>
                    <Text style={{ color: colors.mutedForeground, fontFamily: 'Inter_400Regular', fontSize: 13 }}>No transactions found.</Text>
                  </View>
                ) : (
                  customerEntries.map(entry => (
                    <TransactionRow key={entry.id} entry={entry} colors={colors} />
                  ))
                )}
              </Animated.View>
            )}

            {/* Save */}
            {editing && (
              <Animated.View entering={FadeInDown.delay(120).springify()} style={mStyles.saveWrap}>
                <Pressable
                  onPress={handleSave}
                  disabled={saving || !form.fullName.trim()}
                  style={({ pressed }) => [
                    mStyles.saveBtn,
                    { backgroundColor: colors.primary, opacity: saving || !form.fullName.trim() ? 0.5 : pressed ? 0.88 : 1 },
                  ]}
                >
                  {saving
                    ? <ActivityIndicator color="#fff" />
                    : <Check size={18} color="#fff" />
                  }
                  <Text style={mStyles.saveBtnText}>{saving ? 'Saving…' : customer ? 'Update Customer' : 'Save Customer'}</Text>
                </Pressable>
              </Animated.View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function CustomersScreen() {
  const colors  = useColors();
  const insets  = useSafeAreaInsets();
  const { customers, loading } = useCustomers();

  const [showAdd, setShowAdd]           = useState(false);
  const [selected, setSelected]         = useState<Customer | null>(null);

  const openAdd  = useCallback(() => { Haptics.selectionAsync(); setSelected(null); setShowAdd(true); }, []);
  const openView = useCallback((c: Customer) => { Haptics.selectionAsync(); setSelected(c); setShowAdd(true); }, []);
  const close    = useCallback(() => { setShowAdd(false); setSelected(null); }, []);

  return (
    <View style={[s.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[s.header, { backgroundColor: colors.headerBg, paddingTop: insets.top + 10 }]}>
        <Users size={20} color="#fff" strokeWidth={2} />
        <Text style={s.headerTitle}>Customers</Text>
        <View style={{ width: 20 }} />
      </View>

      {loading ? (
        <View style={s.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : customers.length === 0 ? (
        <EmptyCustomers colors={colors} />
      ) : (
        <FlatList
          data={customers}
          keyExtractor={c => c.id}
          contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 100 }]}
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeInDown.delay(index * 40).springify()}>
              <CustomerRow customer={item} onPress={() => openView(item)} colors={colors} />
            </Animated.View>
          )}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* FAB */}
      <Pressable
        onPress={openAdd}
        style={({ pressed }) => [s.fab, { backgroundColor: colors.primary, opacity: pressed ? 0.88 : 1, transform: [{ scale: pressed ? 0.96 : 1 }] }]}
      >
        <Plus size={26} color="#fff" strokeWidth={2.5} />
      </Pressable>

      <CustomerModal visible={showAdd} customer={selected} onClose={close} />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 14, gap: 10,
  },
  headerTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#fff', flex: 1, textAlign: 'center' },
  list:   { padding: 16, gap: 10 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fab: {
    position: 'absolute', bottom: 24, right: 24,
    width: 58, height: 58, borderRadius: 29,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 10, elevation: 6,
  },
});

const eStyles = StyleSheet.create({
  wrap:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 14 },
  icon:  { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  title: { fontSize: 18, fontFamily: 'Inter_700Bold', textAlign: 'center' },
  sub:   { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 20 },
});

const cStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, borderRadius: 14, borderWidth: 1,
  },
  avatar: {
    width: 50, height: 50, borderRadius: 25, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  avatarImg: { width: 50, height: 50, borderRadius: 25 },
  avatarText: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  info: { flex: 1, gap: 3 },
  name: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  phoneText: { fontSize: 12, fontFamily: 'Inter_400Regular' },
});

const mStyles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: 1,
  },
  title:   { fontSize: 17, fontFamily: 'Inter_700Bold', flex: 1, textAlign: 'center' },
  closeBtn:{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  editBtn: { width: 50, alignItems: 'flex-end', justifyContent: 'center' },
  editText:{ fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  scroll:  { padding: 16, gap: 14 },
  avatarSection: {
    flexDirection: 'row', alignItems: 'center', gap: 16,
    paddingHorizontal: 4, paddingVertical: 8,
  },
  avatarWrap: { position: 'relative' },
  avatar: {
    width: 72, height: 72, borderRadius: 36, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  avatarImg: { width: 72, height: 72, borderRadius: 36 },
  avatarText: { fontSize: 24, fontFamily: 'Inter_700Bold' },
  cameraBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#fff',
  },
  avatarMeta: { flex: 1, gap: 4 },
  avatarName: { fontSize: 20, fontFamily: 'Inter_700Bold', letterSpacing: -0.3 },
  tapHint: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  section: {
    borderRadius: 16, padding: 16, gap: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  sectionTitle: { fontSize: 11, fontFamily: 'Inter_700Bold', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 },
  saveWrap:{ marginTop: 4 },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, height: 52, borderRadius: 14,
  },
  saveBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff' },
  actionsRow: {
    flexDirection: 'row', gap: 12, paddingHorizontal: 4, marginTop: 4, marginBottom: 8,
  },
  actionBtn: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
  },
  detailRow: {
    flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 8,
  },
  detailText: {
    flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 20,
  },
});

const tStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  left: { flex: 1, paddingRight: 12, gap: 4 },
  item: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  date: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  dot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#cbd5e1' },
  type: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  amount: { fontSize: 15, fontFamily: 'Inter_700Bold' },
});

const fieldStyles = StyleSheet.create({
  group: { gap: 6 },
  label: { fontSize: 11, fontFamily: 'Inter_500Medium', textTransform: 'uppercase', letterSpacing: 0.5 },
  row: {
    flexDirection: 'row', borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12,
  },
  input: { flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular', paddingVertical: 0 },
});
