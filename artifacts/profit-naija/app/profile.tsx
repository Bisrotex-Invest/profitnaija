/**
 * Profile screen — personal + business info, saved to AsyncStorage.
 * Fields are always editable; tap Save to persist.
 */
import React, { useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  Linking,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ActivityIndicator,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { pickPhotoAsDataUri } from '@/lib/utils/photo';
import {
  ArrowLeft,
  Camera,
  User,
  Phone,
  Mail,
  MapPin,
  Briefcase,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  LogOut,
  Check,
  Building2,
  CreditCard,
  Percent,
  FileText,
  Info,
  Trash2,
  Share2,
  Database,
  X,
  AlertTriangle,
  ShieldCheck,
} from 'lucide-react-native';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { useProfile, BUSINESS_TYPES, UserProfile } from '@/context/ProfileContext';
import { ACCOUNTING_MONTHS, accountingMonthDays, accountingYearEndForMonth, getAccountingYearRange, formatAccountingDate } from '@workspace/accounting-core';
import { useBilling } from '@/context/BillingContext';
import { isProfileComplete } from '@/lib/utils/profileComplete';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';

// ── Gender options ─────────────────────────────────────────────────────────────
const GENDERS = ['Male', 'Female', 'Prefer not to say'] as const;

// ── Reusable field ─────────────────────────────────────────────────────────────
function Field({
  label,
  value,
  onChangeText,
  placeholder,
  Icon,
  keyboardType,
  autoCapitalize,
  editable = true,
  multiline,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
  Icon: React.ComponentType<{ size: number; color: string }>;
  keyboardType?: any;
  autoCapitalize?: any;
  editable?: boolean;
  multiline?: boolean;
}) {
  const colors = useColors();
  return (
    <View style={fStyles.group}>
      <Text style={[fStyles.label, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={[
        fStyles.row,
        {
          borderColor: colors.input,
          backgroundColor: editable ? colors.background : colors.secondary + '80',
          minHeight: multiline ? 80 : 50,
          alignItems: multiline ? 'flex-start' : 'center',
          paddingTop: multiline ? 12 : 0,
        },
      ]}>
        <View style={{ paddingTop: multiline ? 2 : 0, marginRight: 10 }}>
          <Icon size={16} color={colors.mutedForeground} />
        </View>
        <TextInput
          style={[fStyles.input, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedForeground}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize ?? 'words'}
          editable={editable}
          multiline={multiline}
          textAlignVertical={multiline ? 'top' : 'center'}
        />
      </View>
    </View>
  );
}

// ── Picker field ───────────────────────────────────────────────────────────────
function PickerField({
  label,
  value,
  options,
  onSelect,
  placeholder,
  Icon,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onSelect: (v: string) => void;
  placeholder: string;
  Icon: React.ComponentType<{ size: number; color: string }>;
}) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();

  return (
    <View style={fStyles.group}>
      <Text style={[fStyles.label, { color: colors.mutedForeground }]}>{label}</Text>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          fStyles.row,
          { borderColor: colors.input, backgroundColor: colors.background, height: 50, opacity: pressed ? 0.8 : 1 },
        ]}
      >
        <View style={{ marginRight: 10 }}>
          <Icon size={16} color={colors.mutedForeground} />
        </View>
        <Text
          style={[fStyles.input, { color: value ? colors.foreground : colors.mutedForeground, fontFamily: 'Inter_400Regular', flex: 1 }]}
          numberOfLines={1}
        >
          {value || placeholder}
        </Text>
        <ChevronDown size={16} color={colors.mutedForeground} />
      </Pressable>

      {/* Options modal */}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={pStyles.backdrop} onPress={() => setOpen(false)}>
          <Animated.View
            entering={FadeInDown.springify().damping(18)}
            style={[pStyles.sheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 8 }]}
          >
            <View style={[pStyles.handle, { backgroundColor: colors.border }]} />
            <Text style={[pStyles.sheetTitle, { color: colors.foreground }]}>{label}</Text>
            <FlatList
              data={options as string[]}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => { onSelect(item); setOpen(false); }}
                  style={({ pressed }) => [
                    pStyles.option,
                    { borderBottomColor: colors.border, opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <Text style={[pStyles.optionText, { color: colors.foreground }]}>{item}</Text>
                  {value === item && <Check size={16} color={colors.primary} />}
                </Pressable>
              )}
            />
          </Animated.View>
        </Pressable>
      </Modal>
    </View>
  );
}

// ── Section header ─────────────────────────────────────────────────────────────
function SectionHeader({ title, color }: { title: string; color: string }) {
  return (
    <View style={sStyles.wrap}>
      <View style={[sStyles.bar, { backgroundColor: color }]} />
      <Text style={[sStyles.text, { color }]}>{title}</Text>
    </View>
  );
}

// ── Main screen ────────────────────────────────────────────────────────────────
export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, signOut, deleteAccount } = useAuth();
  const { profile, saveProfile, profileLoading } = useProfile();
  const { billing, openManage, listPayments, cancelRenewal, refreshBilling } = useBilling();
  const { setup } = useLocalSearchParams<{ setup?: string }>();
  // Setup mode: right after sign-up the user must complete their profile
  // before entering the app, so there's nothing to go "back" to.
  const setupMode = setup === '1';
  const [managing, setManaging] = useState(false);

  const [form, setForm] = useState<UserProfile>({ ...profile });
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [agreed, setAgreed] = useState(profile.termsAccepted);

  // Delete-account modal state
  const [showDelete, setShowDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const [payments, setPayments] = useState<any[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [exportingReceipt, setExportingReceipt] = useState<string | null>(null);

  // Sync form when profile loads from AsyncStorage
  useEffect(() => {
    if (!dirty) {
      setForm({ ...profile });
      setAgreed(profile.termsAccepted);
    }
  }, [profile, dirty]);

  useEffect(() => {
    if (!setupMode && user) {
      loadPayments();
    }
  }, [setupMode, user]);

  const loadPayments = async () => {
    setLoadingPayments(true);
    try {
      const data = await listPayments();
      setPayments(data);
    } catch (e) {} finally {
      setLoadingPayments(false);
    }
  };

  const field = (key: keyof UserProfile) => (v: string) => {
    setForm(f => ({ ...f, [key]: v }));
    setDirty(true);
  };

  const handleSave = async () => {
    if (profileLoading) return;
    if (!agreed) return;
    if (!form.accountingYearConfirmed) {
      Alert.alert('Confirm accounting year', 'Please confirm your business’s accounting year before saving your profile.');
      return;
    }
    const next = { ...form, termsAccepted: true };
    if (setupMode && !isProfileComplete(next)) {
      Alert.alert(
        'Almost there',
        'Please fill in your full name, phone number, business name and nature of business, then agree to the Terms.',
      );
      return;
    }
    setSaving(true);
    try {
      await saveProfile(next);
      setDirty(false);
      if (setupMode) router.replace('/subscribe');
      else Alert.alert('Profile saved', 'Your accounting year and business details have been saved.');
    } catch (error: any) {
      Alert.alert('Could not sync profile', error?.message || 'Please reconnect and try again.');
    } finally { setSaving(false); }
  };

  const handleManageSub = async () => {
    setManaging(true);
    try {
      await openManage();
      await refreshBilling();
      await loadPayments();
    } catch (e: any) {
      Alert.alert('Subscription', e?.message ?? 'Could not open subscription settings.');
    } finally {
      setManaging(false);
    }
  };

  const handleCancelRenewal = () => {
    Alert.alert(
      'Cancel Auto-Renewal',
      'Your subscription will remain active until the end of your current billing period, but will not renew automatically.',
      [
        { text: 'Keep Active', style: 'cancel' },
        { 
          text: 'Cancel Renewal', 
          style: 'destructive',
          onPress: async () => {
            setCanceling(true);
            try {
              await cancelRenewal();
              await refreshBilling();
              await loadPayments();
              Alert.alert('Cancelled', 'Your subscription auto-renewal has been cancelled.');
            } catch (e: any) {
              Alert.alert('Error', e?.message ?? 'Could not cancel renewal.');
            } finally {
              setCanceling(false);
            }
          }
        }
      ]
    );
  };

  const handleCheckAgain = async () => {
    setManaging(true);
    try {
      await refreshBilling();
      await loadPayments();
    } finally {
      setManaging(false);
    }
  };

  const safeBusinessName = (value: string) => (value || 'Business').trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'Business';

  const downloadReceipt = async (payment: any) => {
    setExportingReceipt(payment.reference);
    try {
      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
      <title>Receipt ${payment.receiptNumber}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 40px; color: #111827; }
        h1 { color: #16A34A; margin-bottom: 5px; }
        .row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #E5E7EB; }
        .header { display: flex; justify-content: space-between; margin-bottom: 40px; border-bottom: 2px solid #16A34A; padding-bottom: 20px; }
        .total { font-weight: bold; font-size: 1.2em; border-top: 2px solid #111827; margin-top: 10px; }
        .meta { color: #6B7280; font-size: 0.9em; margin-bottom: 20px; }
      </style>
      </head><body>
        <div class="header">
          <div>
            <h1>ProfitNaija</h1>
            <div>Subscription Receipt</div>
          </div>
          <div style="text-align: right;">
            <strong>Receipt Number</strong><br/>${payment.receiptNumber}<br/><br/>
            <strong>Date Paid</strong><br/>${payment.paidAt ? new Date(payment.paidAt).toLocaleDateString() : 'N/A'}
          </div>
        </div>
        <div class="meta">
          <strong>Billed To:</strong><br/>
          ${form.businessName || form.fullName || 'Customer'}<br/>
          ${form.businessAddress ? form.businessAddress + '<br/>' : ''}
          ${form.email || user?.email || ''}
        </div>
        
        <div class="row" style="background: #F3F4F6; padding: 10px; font-weight: bold; border: none;">
          <div>Description</div>
          <div>Amount (NGN)</div>
        </div>
        <div class="row">
          <div>${payment.planName} Plan — Monthly Subscription</div>
          <div>₦${payment.baseAmountNaira?.toLocaleString() ?? 0}</div>
        </div>
        <div class="row">
          <div>VAT (7.5%)</div>
          <div>₦${payment.vatAmountNaira?.toLocaleString() ?? 0}</div>
        </div>
        <div class="row total">
          <div>Total Paid</div>
          <div>₦${payment.grossAmountNaira?.toLocaleString() ?? 0}</div>
        </div>
        <div style="margin-top: 40px; text-align: center; color: #6B7280; font-size: 0.85em;">
          Thank you for using ProfitNaija!<br/>
          Payment Reference: ${payment.reference}
        </div>
      </body></html>`;

      const { uri } = await Print.printToFileAsync({ html });
      const filename = `Receipt-${payment.receiptNumber}.pdf`;

      if (Platform.OS === 'web') {
        const response = await fetch(uri);
        const blob = await response.blob();
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob); link.download = filename; link.click();
        URL.revokeObjectURL(link.href);
      } else if (Platform.OS === 'android') {
        const directory = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (directory.granted) {
          const target = await FileSystem.StorageAccessFramework.createFileAsync(directory.directoryUri, filename, 'application/pdf');
          const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
          await FileSystem.writeAsStringAsync(target, base64, { encoding: FileSystem.EncodingType.Base64 });
          Alert.alert('Saved', 'Receipt saved to your files.');
        }
      } else {
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Subscription Receipt' });
        }
      }
    } catch (e: any) {
      Alert.alert('Export Error', e?.message ?? 'Could not export receipt.');
    } finally {
      setExportingReceipt(null);
    }
  };

  const handlePickImage = async () => {
    // Returns a small self-contained data URI — survives cache clears,
    // web reloads, and syncs safely.
    const uri = await pickPhotoAsDataUri();
    if (uri) {
      setForm(f => ({ ...f, photoUri: uri }));
      setDirty(true);
    }
  };

  const handleDeleteAccount = async () => {
    if (!deletePassword.trim() || deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteAccount(deletePassword);
      setShowDelete(false);
      router.replace('/sign-in');
    } catch (e: any) {
      const code = e?.code ?? '';
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        setDeleteError('Incorrect password. Please try again.');
      } else if (code === 'auth/too-many-requests') {
        setDeleteError('Too many attempts. Please wait a moment and try again.');
      } else {
        setDeleteError(e?.message ?? 'Could not delete account. Please try again.');
      }
    } finally {
      setDeleting(false);
    }
  };

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out', style: 'destructive',
        onPress: async () => {
          await signOut();
          router.replace('/sign-in');
        },
      },
    ]);
  };

  const handleOpenSocialLink = (label: string, url: string) => {
    Linking.openURL(url).catch(() => {
      Alert.alert('Could not open link', `Please try opening ${label} again.`);
    });
  };

  const initials = (form.fullName || user?.displayName || user?.email || '?')
    .trim().split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* ── Top bar ── */}
      <View style={[styles.topBar, { backgroundColor: colors.headerBg, paddingTop: insets.top + 12 }]}>
        {setupMode ? (
          <View style={{ width: 22 }} />
        ) : (
          <Pressable
            onPress={() => router.back()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <ArrowLeft size={22} color="#fff" strokeWidth={2} />
          </Pressable>
        )}
        <Text style={styles.topBarTitle}>{setupMode ? 'Complete Your Profile' : 'My Profile'}</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 120 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Setup notice ── */}
          {setupMode && (
            <View style={[styles.setupBanner, { backgroundColor: colors.primary + '14' }]}>
              <Info size={16} color={colors.primary} />
              <Text style={[styles.setupBannerText, { color: colors.foreground }]}>
                Welcome to ProfitNaija! Fill in your details below and agree to the Terms to
                continue. Fields marked in the message are required.
              </Text>
            </View>
          )}

          {/* ── Avatar + name ── */}
          <Animated.View entering={FadeInDown.springify()} style={styles.avatarSection}>
            {/* Tappable avatar with camera badge */}
            <Pressable onPress={handlePickImage} style={styles.avatarWrap}>
              <View style={[styles.avatar, { backgroundColor: colors.primary + '22', borderColor: colors.primary + '44' }]}>
                {form.photoUri ? (
                  <Image source={{ uri: form.photoUri }} style={styles.avatarImg} />
                ) : (
                  <Text style={[styles.avatarInitials, { color: colors.primary }]}>{initials}</Text>
                )}
              </View>
              {/* Camera badge */}
              <View style={[styles.cameraBadge, { backgroundColor: colors.primary }]}>
                <Camera size={13} color="#fff" strokeWidth={2.5} />
              </View>
            </Pressable>

            {/* Name + business beside photo */}
            <View style={styles.avatarMeta}>
              <Text style={[styles.avatarName, { color: colors.foreground }]} numberOfLines={1}>
                {form.fullName || 'Your Name'}
              </Text>
              {form.businessName ? (
                <Text style={[styles.avatarBiz, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {form.businessName}
                </Text>
              ) : null}
              {form.natureOfBusiness ? (
                <View style={[styles.bizBadge, { backgroundColor: colors.primary + '18' }]}>
                  <Text style={[styles.bizBadgeText, { color: colors.primary }]}>
                    {form.natureOfBusiness}
                  </Text>
                </View>
              ) : null}
              <Text style={[styles.tapHint, { color: colors.mutedForeground }]}>
                Tap photo to change
              </Text>
            </View>
          </Animated.View>

          {/* ── Personal info ── */}
          <Animated.View entering={FadeInDown.delay(80).springify()} style={[styles.section, { backgroundColor: colors.card }]}>
            <SectionHeader title="Personal Information" color={colors.primary} />

            <Field
              label="Full Name"
              value={form.fullName}
              onChangeText={field('fullName')}
              placeholder="Your full name"
              Icon={User}
            />
            <PickerField
              label="Gender"
              value={form.gender}
              options={GENDERS}
              onSelect={field('gender')}
              placeholder="Select gender"
              Icon={User}
            />
            <Field
              label="Phone Number"
              value={form.phone}
              onChangeText={field('phone')}
              placeholder="08012345678"
              Icon={Phone}
              keyboardType="phone-pad"
              autoCapitalize="none"
            />
            <Field
              label="Email Address"
              value={form.email || user?.email || ''}
              onChangeText={field('email')}
              placeholder="you@example.com"
              Icon={Mail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <Field
              label="Home Address"
              value={form.homeAddress}
              onChangeText={field('homeAddress')}
              placeholder="Street, City, State"
              Icon={MapPin}
              multiline
            />
          </Animated.View>

          {/* ── Business info ── */}
          <Animated.View entering={FadeInDown.delay(140).springify()} style={[styles.section, { backgroundColor: colors.card }]}>
            <SectionHeader title="Business Information" color="#3B82F6" />

            <Field
              label="Business Name"
              value={form.businessName}
              onChangeText={field('businessName')}
              placeholder="e.g. Mama Caro Provisions"
              Icon={Briefcase}
            />
            <Field
              label="Business Address"
              value={form.businessAddress}
              onChangeText={field('businessAddress')}
              placeholder="Shop / stall address"
              Icon={Building2}
              multiline
            />
            <Field
              label="Business Phone"
              value={form.businessPhone}
              onChangeText={field('businessPhone')}
              placeholder="08012345678"
              Icon={Phone}
              keyboardType="phone-pad"
              autoCapitalize="none"
            />
            <PickerField
              label="Nature of Business"
              value={form.natureOfBusiness}
              options={BUSINESS_TYPES}
              onSelect={field('natureOfBusiness')}
              placeholder="Select business type"
              Icon={Briefcase}
            />
            <SectionHeader title="Accounting Year" color="#3B82F6" />
            <PickerField
              label="Year-end month"
              placeholder="Select month"
              value={ACCOUNTING_MONTHS[Number(form.accountingYearEnd.slice(0, 2)) - 1]}
              options={[...ACCOUNTING_MONTHS]}
              onSelect={name => {
                setForm(previous => ({ ...previous,
                  accountingYearEnd: accountingYearEndForMonth(previous.accountingYearEnd, ACCOUNTING_MONTHS.indexOf(name as typeof ACCOUNTING_MONTHS[number]) + 1),
                  accountingYearConfirmed: false }));
                setDirty(true);
              }}
              Icon={CalendarClock}
            />
            <PickerField
              label="Year-end day"
              placeholder="Select day"
              value={String(Number(form.accountingYearEnd.slice(3)))}
              options={Array.from({ length: accountingMonthDays(Number(form.accountingYearEnd.slice(0, 2))) }, (_, index) => String(index + 1))}
              onSelect={day => {
                setForm(previous => ({ ...previous, accountingYearEnd: `${previous.accountingYearEnd.slice(0, 2)}-${day.padStart(2, '0')}`, accountingYearConfirmed: false }));
                setDirty(true);
              }}
              Icon={CalendarClock}
            />
            <Text style={{ color: colors.mutedForeground, fontSize: 13, marginBottom: 12 }}>
              {(() => {
                const now = new Date();
                const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
                const range = getAccountingYearRange(today, form.accountingYearEnd);
                return `Current accounting year: ${formatAccountingDate(range.start)} – ${formatAccountingDate(range.end)}`;
              })()}
              {'\n'}Controls financial reports and dashboard annual totals. Tax Center stays calendar-based.
              {form.accountingYearEnd === '02-29' ? '\nIn non-leap years, the closing date is 28 February.' : ''}
            </Text>
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: form.accountingYearConfirmed }}
              accessibilityLabel="I confirm this is my business’s accounting year"
              onPress={() => {
                setForm(previous => ({ ...previous, accountingYearConfirmed: !previous.accountingYearConfirmed }));
                setDirty(true);
              }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 }}>
              <View style={{ width: 24, height: 24, borderWidth: 1, borderColor: colors.primary, borderRadius: 4, alignItems: 'center', justifyContent: 'center' }}>
                {form.accountingYearConfirmed && <Check size={18} color={colors.primary} />}
              </View>
              <Text style={{ flex: 1, color: colors.foreground, fontSize: 14 }}>I confirm this is my business’s accounting year.</Text>
            </Pressable>
            <Text style={{ color: colors.mutedForeground, fontSize: 12, marginBottom: 16 }}>
              Save Changes to apply. Changing the year-end changes reporting dates only; transactions, cash, inventory and debts carry forward unchanged. Set opening balances separately under Opening Balances &amp; Equity.
            </Text>
            {/* Nigerian PIT info — bands are applied automatically, no manual entry needed */}
            <View style={[styles.pitCard, { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' }]}>
              <View style={styles.pitHeader}>
                <Info size={14} color="#166534" />
                <Text style={[styles.pitHeaderText, { color: '#166534' }]}>
                  Income Tax — Nigeria Tax Act (2026 PIT Bands)
                </Text>
              </View>
              <Text style={[styles.pitNote, { color: '#166534' }]}>
                Applied automatically on your Profit &amp; Loss report. No manual entry needed.
              </Text>
              {[
                ['First ₦800,000',       '0%'],
                ['Next ₦2,200,000',     '15%'],
                ['Next ₦9,000,000',     '18%'],
                ['Next ₦13,000,000',    '21%'],
                ['Next ₦25,000,000',    '23%'],
                ['Above ₦50,000,000',   '25%'],
              ].map(([band, rate]) => (
                <View key={`${band}-${rate}`} style={styles.pitRow}>
                  <Text style={[styles.pitBand, { color: '#166534' }]}>{band}</Text>
                  <Text style={[styles.pitRate, { color: '#166534' }]}>{rate}</Text>
                </View>
              ))}
            </View>
          </Animated.View>

          {/* ── Subscription ── */}
          {!setupMode && (
            <Animated.View entering={FadeInDown.delay(160).springify()} style={[styles.section, { backgroundColor: colors.card }]}>
              <SectionHeader title="Subscription" color="#8B5CF6" />
              
              {billing.reconciliationState === 'payment_received_access_pending' && (
                <View style={[styles.reconcileCard, { backgroundColor: '#FEF3C7', borderColor: '#F59E0B' }]}>
                  <AlertTriangle size={18} color="#D97706" />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.reconcileTitle, { color: '#92400E' }]}>Payment received but access pending</Text>
                    <Text style={[styles.reconcileText, { color: '#92400E' }]}>
                      {billing.reconciliationMessage || 'We are waiting for Paystack to finalize your payment. This usually takes a few minutes.'}
                    </Text>
                    <TouchableOpacity onPress={handleCheckAgain} style={styles.checkAgainBtn} disabled={managing}>
                      <Text style={styles.checkAgainText}>{managing ? 'Checking...' : 'Check again'}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              <View style={styles.subRow}>
                <CreditCard size={16} color={colors.mutedForeground} />
                <Text style={[styles.subLabel, { color: colors.mutedForeground }]}>Plan</Text>
                <Text style={[styles.subValue, { color: colors.foreground }]}>
                  {billing.currentPlanName || (billing.currentPlan === 'none' ? 'None' : billing.currentPlan)}
                </Text>
              </View>
              <View style={styles.subRow}>
                <CalendarClock size={16} color={colors.mutedForeground} />
                <Text style={[styles.subLabel, { color: colors.mutedForeground }]}>Status</Text>
                <Text style={[
                  styles.subValue,
                  { color: billing.hasAccess ? '#16A34A' : '#DC2626' },
                ]}>
                  {billing.state === 'trial' ? 'Free trial' :
                   billing.state === 'active' ? 'Active' :
                   billing.state === 'expired' ? 'Expired' :
                   billing.state === 'none' ? 'Not subscribed' : 'Checking…'}
                </Text>
              </View>
              
              {billing.failedRenewalReason && (
                <Text style={[styles.subErrorHint, { color: '#DC2626' }]}>
                  ⚠️ {billing.failedRenewalReason}
                </Text>
              )}
              
              {billing.nextRenewalDate ? (
                <Text style={[styles.subHint, { color: colors.mutedForeground }]}>
                  {billing.state === 'trial' ? 'First charge on: ' : 'Next renewal: '}
                  {new Date(billing.nextRenewalDate).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })}
                </Text>
              ) : null}
              
              <View style={styles.subActions}>
                {billing.hasAccess ? (
                  <>
                    <TouchableOpacity
                      activeOpacity={0.8}
                      onPress={handleManageSub}
                      disabled={managing}
                      style={[styles.subBtn, { borderColor: colors.primary, opacity: managing ? 0.6 : 1, flex: 1 }]}
                    >
                      <Text style={[styles.subBtnText, { color: colors.primary }]}>
                        {managing ? 'Opening…' : 'Change Payment Method'}
                      </Text>
                    </TouchableOpacity>
                    {billing.nextRenewalDate && (
                      <TouchableOpacity
                        activeOpacity={0.8}
                        onPress={handleCancelRenewal}
                        disabled={canceling}
                        style={[styles.subBtn, { borderColor: '#FCA5A5', opacity: canceling ? 0.6 : 1, marginTop: 8 }]}
                      >
                        <Text style={[styles.subBtnText, { color: '#DC2626' }]}>
                          {canceling ? 'Canceling…' : 'Cancel Auto-Renewal'}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </>
                ) : (
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => router.push('/subscribe')}
                    style={[styles.subBtn, { backgroundColor: colors.primary, borderColor: colors.primary }]}
                  >
                    <Text style={[styles.subBtnText, { color: '#fff' }]}>Choose a Plan</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Payment History */}
              {payments.length > 0 && (
                <View style={styles.historyContainer}>
                  <Text style={[styles.historyTitle, { color: colors.foreground }]}>Payment History</Text>
                  {payments.map((p) => (
                    <View key={p.reference} style={[styles.historyRow, { borderColor: colors.border }]}>
                      <View style={styles.historyMain}>
                        <View>
                          <Text style={[styles.historyPlan, { color: colors.foreground }]}>{p.planName} Plan</Text>
                          <Text style={[styles.historyDate, { color: colors.mutedForeground }]}>
                            {new Date(p.attemptedAt).toLocaleDateString()}
                          </Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={[styles.historyAmount, { color: colors.foreground }]}>
                            ₦{p.grossAmountNaira?.toLocaleString()}
                          </Text>
                          <Text style={[
                            styles.historyStatus, 
                            { color: p.status === 'success' ? '#16A34A' : '#DC2626' }
                          ]}>
                            {p.status === 'success' ? 'Paid' : 'Failed'}
                          </Text>
                        </View>
                      </View>
                      {p.status === 'success' && p.receiptNumber ? (
                        <TouchableOpacity 
                          style={styles.receiptBtn} 
                          onPress={() => downloadReceipt(p)}
                          disabled={exportingReceipt === p.reference}
                        >
                          {exportingReceipt === p.reference ? (
                            <ActivityIndicator size="small" color={colors.primary} />
                          ) : (
                            <Text style={[styles.receiptText, { color: colors.primary }]}>Download Receipt</Text>
                          )}
                        </TouchableOpacity>
                      ) : null}
                      {p.status === 'failed' && p.failureReason ? (
                        <Text style={[styles.historyError, { color: '#DC2626' }]}>{p.failureReason}</Text>
                      ) : null}
                    </View>
                  ))}
                </View>
              )}
            </Animated.View>
          )}

          {!setupMode && (
            <Animated.View entering={FadeInDown.delay(164).springify()} style={[styles.section, { backgroundColor: colors.card }]}>
              <TouchableOpacity onPress={() => router.push('/referrals')} style={styles.adminRow}>
                <View style={styles.adminRowLeft}>
                  <View style={[styles.adminIcon, { backgroundColor: colors.revenueBg }]}>
                    <Share2 size={16} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.adminLabel, { color: colors.foreground }]}>Referral Account</Text>
                    <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 2 }}>Create your code, track commissions and request withdrawals</Text>
                  </View>
                </View>
                <ChevronRight size={16} color={colors.primary} />
              </TouchableOpacity>
              <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 4 }} />
              <TouchableOpacity onPress={() => router.push('/data-backup')} style={styles.adminRow}>
                <View style={styles.adminRowLeft}>
                  <View style={[styles.adminIcon, { backgroundColor: colors.revenueBg }]}>
                    <Database size={16} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.adminLabel, { color: colors.foreground }]}>Data &amp; Backup</Text>
                    <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 2 }}>Secure your records in the cloud or download them</Text>
                  </View>
                </View>
                <ChevronRight size={16} color={colors.primary} />
              </TouchableOpacity>
              <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 4 }} />
              <TouchableOpacity onPress={() => router.push('/pro-tools')} style={styles.adminRow}>
                <View style={styles.adminRowLeft}>
                  <View style={[styles.adminIcon, { backgroundColor: colors.revenueBg }]}>
                    <ShieldCheck size={16} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.adminLabel, { color: colors.foreground }]}>Pro Tools</Text>
                    <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 2 }}>Credit reminders, planning, margins and tax reports</Text>
                  </View>
                </View>
                <ChevronRight size={16} color={colors.primary} />
              </TouchableOpacity>
            </Animated.View>
          )}

          {/* ── Admin Panel shortcut ── */}
          {!setupMode && user?.email?.toLowerCase() === (process.env.EXPO_PUBLIC_ADMIN_EMAIL ?? '').toLowerCase() && (process.env.EXPO_PUBLIC_ADMIN_EMAIL ?? '') !== '' && (
            <Animated.View entering={FadeInDown.delay(165).springify()} style={[styles.section, { backgroundColor: '#F5F3FF', borderColor: '#DDD6FE', borderWidth: 1.5 }]}>
              <TouchableOpacity
                onPress={() => router.push('/admin')}
                style={styles.adminRow}
              >
                <View style={styles.adminRowLeft}>
                  <View style={[styles.adminIcon, { backgroundColor: '#EDE9FE' }]}>
                    <Info size={16} color="#7C3AED" />
                  </View>
                  <Text style={[styles.adminLabel, { color: '#5B21B6' }]}>Admin Panel — Manage Subscriptions</Text>
                </View>
                <ChevronRight size={16} color="#7C3AED" />
              </TouchableOpacity>
            </Animated.View>
          )}

          {/* ── Social links ── */}
          <Animated.View entering={FadeInDown.delay(168).springify()} style={[styles.section, { backgroundColor: colors.card }]}>
            <SectionHeader title="Follow ProfitNaija" color={colors.primary} />
            <Text style={[styles.socialIntro, { color: colors.mutedForeground }]}>
              Follow us for business tips, product updates, and helpful resources for Nigerian business owners.
            </Text>
            <View style={styles.socialGrid}>
              {[
                { label: 'X', mark: '𝕏', url: 'https://x.com/profitnaija', color: '#111827' },
                { label: 'Facebook', mark: 'f', url: 'https://www.facebook.com/profile.php?id=61594066644514', color: '#1877F2' },
                { label: 'Instagram', mark: '◎', url: 'https://www.instagram.com/profitnaija/', color: '#C13584' },
              ].map((social) => (
                <TouchableOpacity
                  key={social.label}
                  activeOpacity={0.75}
                  onPress={() => handleOpenSocialLink(social.label, social.url)}
                  accessibilityRole="link"
                  accessibilityLabel={`Open ProfitNaija on ${social.label}`}
                  style={[styles.socialButton, { borderColor: colors.border, backgroundColor: colors.background }]}
                >
                  <View style={[styles.socialMark, { backgroundColor: social.color }]}>
                    <Text style={styles.socialMarkText}>{social.mark}</Text>
                  </View>
                  <Text style={[styles.socialLabel, { color: colors.foreground }]}>{social.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </Animated.View>

          {/* ── Terms & Conditions ── */}
          <Animated.View entering={FadeInDown.delay(170).springify()} style={[styles.section, { backgroundColor: colors.card }]}>
            <SectionHeader title="Terms & Conditions" color={colors.primary} />
            <Pressable
              onPress={() => { setAgreed(a => !a); setDirty(true); }}
              style={({ pressed }) => [styles.agreeRow, { opacity: pressed ? 0.8 : 1 }]}
            >
              <View style={[
                styles.checkbox,
                { borderColor: agreed ? colors.primary : colors.border, backgroundColor: agreed ? colors.primary : 'transparent' },
              ]}>
                {agreed && <Check size={14} color="#fff" strokeWidth={3} />}
              </View>
              <Text style={[styles.agreeText, { color: colors.foreground }]}>
                I agree to the ProfitNaija Terms &amp; Conditions
              </Text>
            </Pressable>
            <Pressable onPress={() => router.push('/terms')} style={({ pressed }) => [styles.linkRow, { opacity: pressed ? 0.7 : 1 }]}>
              <FileText size={14} color={colors.primary} />
              <Text style={[styles.linkText, { color: colors.primary }]}>Read the Terms &amp; Conditions</Text>
            </Pressable>
            {!agreed && (
              <Text style={[styles.agreeHint, { color: '#C62828' }]}>
                You must agree to the Terms &amp; Conditions before saving changes.
              </Text>
            )}
          </Animated.View>

          {/* ── Sign out ── */}
          <Animated.View entering={FadeInDown.delay(200).springify()}>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={handleSignOut}
              style={[styles.signOutBtn, { backgroundColor: '#FEE2E2', borderColor: '#FECACA' }]}
            >
              <LogOut size={18} color="#DC2626" strokeWidth={2} />
              <Text style={styles.signOutText}>Sign Out</Text>
            </TouchableOpacity>
          </Animated.View>

          {/* ── Delete account ── */}
          <Animated.View entering={FadeInDown.delay(230).springify()}>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => { setDeletePassword(''); setDeleteError(''); setShowDelete(true); }}
              style={[styles.deleteBtn, { borderColor: '#FECACA' }]}
            >
              <Trash2 size={16} color="#DC2626" strokeWidth={2} />
              <Text style={styles.deleteBtnText}>Delete My Account</Text>
            </TouchableOpacity>
            <Text style={[styles.deleteHint, { color: colors.mutedForeground }]}>
              Permanently removes your account and all business records. This cannot be undone.
            </Text>
          </Animated.View>

          {/* ── Footer links ── */}
          <View style={styles.footer}>
            <Pressable onPress={() => router.push('/about')} style={({ pressed }) => [styles.footerLink, { opacity: pressed ? 0.7 : 1 }]}>
              <Info size={14} color={colors.mutedForeground} />
              <Text style={[styles.footerLinkText, { color: colors.mutedForeground }]}>About Us</Text>
              <ChevronRight size={14} color={colors.mutedForeground} />
            </Pressable>
            <Pressable onPress={() => router.push('/terms')} style={({ pressed }) => [styles.footerLink, { opacity: pressed ? 0.7 : 1 }]}>
              <FileText size={14} color={colors.mutedForeground} />
              <Text style={[styles.footerLinkText, { color: colors.mutedForeground }]}>Terms &amp; Conditions</Text>
              <ChevronRight size={14} color={colors.mutedForeground} />
            </Pressable>
            <Text style={[styles.footerCopy, { color: colors.mutedForeground }]}>
              © 2026 ProfitNaija, powered by Bisrotex Investment Synergy Limited, a registered
              Nigerian company with RC: 1700008
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── Floating Save button ── */}
      {dirty && (
        <View style={[styles.saveBar, { paddingBottom: insets.bottom + 12, backgroundColor: colors.background }]}>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={handleSave}
            disabled={saving || !agreed}
            style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: agreed ? 1 : 0.5 }]}
          >
            <Text style={styles.saveBtnText}>
              {saving ? 'Saving…' : agreed ? 'Save Changes' : 'Agree to Terms to Save'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Delete account confirmation modal ── */}
      <Modal visible={showDelete} transparent animationType="fade" onRequestClose={() => !deleting && setShowDelete(false)}>
        <View style={styles.deleteBackdrop}>
          <View style={[styles.deleteCard, { backgroundColor: colors.card }]}>
            <View style={styles.deleteCardHeader}>
              <Text style={[styles.deleteCardTitle, { color: colors.foreground }]}>Delete Account?</Text>
              <Pressable onPress={() => !deleting && setShowDelete(false)} hitSlop={8}>
                <X size={20} color={colors.mutedForeground} />
              </Pressable>
            </View>
            <Text style={[styles.deleteCardBody, { color: colors.mutedForeground }]}>
              This permanently deletes your account and ALL your business records — sales, purchases,
              expenses, products, stock and customers. This cannot be undone.
            </Text>
            <Text style={[styles.deleteCardBody, { color: colors.mutedForeground }]}>
              Enter your password to confirm:
            </Text>
            <TextInput
              style={[styles.deleteInput, { borderColor: colors.input, color: colors.foreground, backgroundColor: colors.background }]}
              value={deletePassword}
              onChangeText={(t) => { setDeletePassword(t); setDeleteError(''); }}
              placeholder="Your password"
              placeholderTextColor={colors.mutedForeground}
              secureTextEntry
              autoCapitalize="none"
              editable={!deleting}
            />
            {!!deleteError && <Text style={styles.deleteErrorText}>{deleteError}</Text>}
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={handleDeleteAccount}
              disabled={deleting || !deletePassword.trim()}
              style={[styles.deleteConfirmBtn, { opacity: deleting || !deletePassword.trim() ? 0.5 : 1 }]}
            >
              <Text style={styles.deleteConfirmText}>
                {deleting ? 'Deleting…' : 'Permanently Delete Account'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => setShowDelete(false)}
              disabled={deleting}
              style={styles.deleteCancelBtn}
            >
              <Text style={[styles.deleteCancelText, { color: colors.mutedForeground }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  topBarTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: '#fff' },

  scroll: { padding: 16, gap: 16 },

  avatarSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 4,
    paddingBottom: 4,
  },
  avatarWrap: { position: 'relative' },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: 84, height: 84, borderRadius: 42 },
  avatarInitials: { fontSize: 28, fontFamily: 'Inter_700Bold' },
  cameraBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  avatarMeta: { flex: 1, gap: 4 },
  avatarName: { fontSize: 20, fontFamily: 'Inter_700Bold', letterSpacing: -0.3 },
  avatarBiz: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  bizBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20, marginTop: 2 },
  bizBadgeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  tapHint: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },

  section: {
    borderRadius: 16,
    padding: 16,
    gap: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },

  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 4,
  },
  signOutText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#DC2626' },

  setupBanner: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start',
    borderRadius: 12, padding: 14, marginBottom: 14,
  },
  setupBannerText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 19 },

  subRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  subLabel: { fontSize: 13, fontFamily: 'Inter_500Medium', width: 52 },
  subValue: { fontSize: 13, fontFamily: 'Inter_600SemiBold', flex: 1 },
  subHint: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2, marginLeft: 24 },
  subErrorHint: { fontSize: 12, fontFamily: 'Inter_500Medium', color: '#DC2626', marginTop: 8 },
  subActions: { marginTop: 12 },
  subBtn: {
    borderWidth: 1.5, borderRadius: 12, paddingVertical: 12,
    alignItems: 'center', marginTop: 10,
  },
  subBtnText: { fontSize: 13.5, fontFamily: 'Inter_600SemiBold' },
  reconcileCard: { flexDirection: 'row', gap: 10, padding: 14, borderRadius: 12, borderWidth: 1, marginBottom: 16 },
  reconcileTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', marginBottom: 2 },
  reconcileText: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 18 },
  checkAgainBtn: { marginTop: 8, alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 12, backgroundColor: 'rgba(255,255,255,0.5)', borderRadius: 6 },
  checkAgainText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#92400E' },
  historyContainer: { marginTop: 24, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.05)', paddingTop: 16 },
  historyTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', marginBottom: 12 },
  historyRow: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 12 },
  historyMain: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  historyPlan: { fontSize: 14, fontFamily: 'Inter_500Medium' },
  historyDate: { fontSize: 12, marginTop: 2 },
  historyAmount: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  historyStatus: { fontSize: 12, fontFamily: 'Inter_600SemiBold', marginTop: 2 },
  historyError: { fontSize: 12, marginTop: 6 },
  receiptBtn: { alignSelf: 'flex-start', marginTop: 6, paddingVertical: 4, paddingHorizontal: 8, backgroundColor: 'rgba(0,0,0,0.03)', borderRadius: 6 },
  receiptText: { fontSize: 12, fontFamily: 'Inter_500Medium' },

  pitCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginTop: 10 },
  pitHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  pitHeaderText: { fontSize: 12.5, fontFamily: 'Inter_600SemiBold', flex: 1 },
  pitNote: { fontSize: 12, fontFamily: 'Inter_400Regular', marginBottom: 10, lineHeight: 17 },
  pitRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  pitBand: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  pitRate: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },

  adminRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  adminRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  adminIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  adminLabel: { fontSize: 14, fontFamily: 'Inter_600SemiBold', flex: 1 },

  taxHint: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 18, marginTop: -6 },

  socialIntro: { fontSize: 12.5, fontFamily: 'Inter_400Regular', lineHeight: 18, marginTop: -4 },
  socialGrid: { flexDirection: 'row', gap: 8 },
  socialButton: {
    flex: 1,
    minHeight: 74,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 4,
  },
  socialMark: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  socialMarkText: { color: '#fff', fontSize: 17, fontFamily: 'Inter_700Bold', lineHeight: 20 },
  socialLabel: { fontSize: 11.5, fontFamily: 'Inter_600SemiBold' },

  agreeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  agreeText: { flex: 1, fontSize: 14, fontFamily: 'Inter_500Medium', lineHeight: 20 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 34 },
  linkText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  agreeHint: { fontSize: 12, fontFamily: 'Inter_400Regular', paddingLeft: 34 },

  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, height: 48, borderRadius: 14, borderWidth: 1,
  },
  deleteBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#DC2626' },
  deleteHint: { fontSize: 11, fontFamily: 'Inter_400Regular', textAlign: 'center', marginTop: 8, paddingHorizontal: 20 },

  footer: { alignItems: 'center', gap: 2, paddingTop: 8 },
  footerLink: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 10, paddingHorizontal: 12,
  },
  footerLinkText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  footerCopy: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 6 },

  deleteBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  deleteCard: { width: '100%', borderRadius: 18, padding: 20, gap: 12 },
  deleteCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  deleteCardTitle: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  deleteCardBody: { fontSize: 13.5, fontFamily: 'Inter_400Regular', lineHeight: 20 },
  deleteInput: {
    borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14,
    height: 48, fontSize: 15, fontFamily: 'Inter_400Regular',
  },
  deleteErrorText: { fontSize: 12.5, fontFamily: 'Inter_500Medium', color: '#DC2626' },
  deleteConfirmBtn: {
    height: 50, borderRadius: 13, backgroundColor: '#DC2626',
    alignItems: 'center', justifyContent: 'center',
  },
  deleteConfirmText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },
  deleteCancelBtn: { height: 44, alignItems: 'center', justifyContent: 'center' },
  deleteCancelText: { fontSize: 14, fontFamily: 'Inter_500Medium' },

  saveBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.08)',
  },
  saveBtn: {
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff' },
});

// Field styles
const fStyles = StyleSheet.create({
  group: { gap: 6 },
  label: { fontSize: 12, fontFamily: 'Inter_500Medium', textTransform: 'uppercase', letterSpacing: 0.5 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  input: { flex: 1, fontSize: 15, paddingVertical: 0 },
});

// Picker styles
const pStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    maxHeight: '70%',
  },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', paddingHorizontal: 20, marginBottom: 8 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  optionText: { fontSize: 15, fontFamily: 'Inter_400Regular' },
});

// Section header styles
const sStyles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  bar: { width: 3, height: 18, borderRadius: 2 },
  text: { fontSize: 12, fontFamily: 'Inter_700Bold', textTransform: 'uppercase', letterSpacing: 1 },
});
