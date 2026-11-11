import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Check,
  Database,
  Download,
  Upload,
  Clock,
  RotateCcw,
  FileText,
  AlertCircle,
  Cloud,
} from 'lucide-react-native';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { useEntries } from '@/context/EntriesContext';
import { useBilling } from '@/context/BillingContext';
import * as Sharing from 'expo-sharing';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import { File } from 'expo-file-system';
import {
  useGetBackupStatus,
  useUpdateBackupSettings,
  useRunBackup,
  useRestoreBackup,
  useImportBackupProducts,
  getGetBackupStatusQueryKey,
} from '@workspace/api-client-react';

function SectionHeader({ title, color, subtitle }: { title: string; color: string; subtitle?: string }) {
  return (
    <View style={sStyles.wrap}>
      <View style={sStyles.titleRow}>
        <View style={[sStyles.bar, { backgroundColor: color }]} />
        <Text style={[sStyles.text, { color }]}>{title}</Text>
      </View>
      {subtitle && <Text style={sStyles.subtitle}>{subtitle}</Text>}
    </View>
  );
}

const sStyles = StyleSheet.create({
  wrap: { marginBottom: 16 },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  bar: { width: 4, height: 16, borderRadius: 2, marginRight: 8 },
  text: { fontSize: 14, fontFamily: 'Inter_700Bold', textTransform: 'uppercase', letterSpacing: 0.5 },
  subtitle: { fontSize: 13, color: '#6B7280', marginTop: 4, fontFamily: 'Inter_400Regular' },
});

export default function DataBackupScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { pendingCount } = useEntries();
  const { hasProAccess } = useBilling();
  const queryClient = useQueryClient();

  const { data: status, isLoading: statusLoading } = useGetBackupStatus({
    query: { enabled: hasProAccess, queryKey: getGetBackupStatusQueryKey() },
  });

  const updateSettings = useUpdateBackupSettings({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetBackupStatusQueryKey() }),
      onError: (e: any) => Alert.alert('Error', e?.message || 'Could not update settings'),
    },
  });

  const runBackup = useRunBackup({
    mutation: {
      onSuccess: () => {
        Alert.alert('Success', 'Backup completed successfully.');
        queryClient.invalidateQueries({ queryKey: getGetBackupStatusQueryKey() });
      },
      onError: (e: any) => Alert.alert('Error', e?.message || 'Could not run backup'),
    },
  });

  const restoreBackup = useRestoreBackup({
    mutation: {
      onSuccess: () => {
        Alert.alert('Success', 'Data restored successfully.');
        queryClient.invalidateQueries({ queryKey: getGetBackupStatusQueryKey() });
      },
      onError: (e: any) => Alert.alert('Error', e?.message || 'Could not restore backup'),
    },
  });

  const importProducts = useImportBackupProducts({
    mutation: {
      onSuccess: (res) => {
        Alert.alert('Import Complete', `${res.imported} products imported. ${res.skipped} skipped.\n\n${res.errors.join('\n')}`);
      },
      onError: (e: any) => Alert.alert('Error', e?.message || 'Could not import products'),
    },
  });

  const [downloading, setDownloading] = useState<string | null>(null);

  const handleToggleAuto = (val: boolean) => {
    if (!status) return;
    updateSettings.mutate({ data: { enabled: val, frequency: status.settings.frequency } });
  };

  const handleChangeFreq = (freq: 'daily' | 'weekly') => {
    if (!status) return;
    updateSettings.mutate({ data: { enabled: status.settings.enabled, frequency: freq } });
  };

  const handleExport = async (format: 'json' | 'csv' | 'xlsx', scope: 'all' | 'products' | 'customers') => {
    if (pendingCount > 0) {
      Alert.alert('Finish syncing first', `${pendingCount} record${pendingCount === 1 ? ' is' : 's are'} still waiting to sync. Keep the app open and try again shortly.`);
      return;
    }
    setDownloading(`${scope}-${format}`);
    try {
      const token = await user?.getIdToken();
      if (!token) throw new Error('Not authenticated');
      
      const fileUri = FileSystemLegacy.cacheDirectory + `profitnaija_${scope}_export_${Date.now()}.${format}`;
      const domain = process.env.EXPO_PUBLIC_DOMAIN;
      const url = `https://${domain}/api/backup/export?format=${format}&scope=${scope}`;
      
      const response = await FileSystemLegacy.downloadAsync(url, fileUri, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (response.status !== 200) {
        throw new Error('Export failed. Please try again.');
      }
      
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('Success', `Export downloaded to ${response.uri}`);
        return;
      }
      
      const mimeTypes = {
        'json': 'application/json',
        'csv': 'text/csv',
        'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      };
      const UTIs = {
        'json': 'public.json',
        'csv': 'public.comma-separated-values-text',
        'xlsx': 'org.openxmlformats.spreadsheetml.sheet'
      };

      await Sharing.shareAsync(response.uri, {
        dialogTitle: `Export ${scope} data`,
        mimeType: mimeTypes[format],
        UTI: UTIs[format]
      });
    } catch (e: any) {
      Alert.alert('Export Error', e?.message || 'Could not export data.');
    } finally {
      setDownloading(null);
    }
  };

  const handleRestore = (backupId: string) => {
    Alert.alert(
      'Restore Backup',
      'This will add missing records and restore saved values without deleting newer records. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Restore', style: 'destructive', onPress: () => restoreBackup.mutate({ backupId, data: { confirm: true } }) }
      ]
    );
  };

  const handleImportProducts = async () => {
    try {
      let file = await File.pickFileAsync(undefined, '*/*');
      if (Array.isArray(file)) file = file[0];
      if (!file) return;

      const contentBase64 = await FileSystemLegacy.readAsStringAsync(file.uri, {
        encoding: FileSystemLegacy.EncodingType.Base64,
      });

      importProducts.mutate({
        data: {
          fileName: decodeURIComponent(file.uri.split('/').pop() || '') || (file.type.includes('spreadsheet') ? 'import.xlsx' : 'import.csv'),
          contentBase64,
        },
      });
    } catch (e: any) {
      Alert.alert('Import Error', e?.message || 'Could not select file.');
    }
  };

  if (!hasProAccess) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.topBar, { backgroundColor: colors.headerBg, paddingTop: insets.top + 12 }]}>
          <Pressable onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <ArrowLeft size={22} color="#fff" strokeWidth={2} />
          </Pressable>
          <Text style={styles.topBarTitle}>Data &amp; Backup</Text>
          <View style={{ width: 22 }} />
        </View>
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
          <Animated.View entering={FadeInDown.springify()} style={[styles.section, { backgroundColor: colors.card, alignItems: 'center', paddingVertical: 40 }]}>
            <View style={[styles.iconBox, { width: 64, height: 64, borderRadius: 32, marginBottom: 16 }]}>
              <Database size={32} color={colors.primary} />
            </View>
            <Text style={[styles.label, { color: colors.foreground, fontSize: 18, marginBottom: 8, textAlign: 'center' }]}>Data &amp; Backup is a Pro feature</Text>
            <Text style={[styles.desc, { color: colors.mutedForeground, textAlign: 'center', marginBottom: 24, fontSize: 14, lineHeight: 22 }]}>
              Upgrade to the Pro plan to enable automatic cloud backups, manual data exports, and bulk imports for your business data.
            </Text>
            <TouchableOpacity 
              activeOpacity={0.8}
              onPress={() => router.push('/profile')}
              style={[styles.btn, { backgroundColor: colors.primary, width: '100%' }]}
            >
              <Text style={styles.btnText}>Upgrade to Pro</Text>
            </TouchableOpacity>
          </Animated.View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.topBar, { backgroundColor: colors.headerBg, paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <ArrowLeft size={22} color="#fff" strokeWidth={2} />
        </Pressable>
        <Text style={styles.topBarTitle}>Data &amp; Backup</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {statusLoading ? (
          <View style={{ padding: 40, alignItems: 'center' }}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : !status ? (
          <View style={{ padding: 40, alignItems: 'center' }}>
            <Text style={{ color: colors.mutedForeground }}>Could not load backup status.</Text>
          </View>
        ) : (
          <>
            <Animated.View entering={FadeInDown.springify()} style={[styles.section, { backgroundColor: colors.card }]}>
              <SectionHeader title="Cloud Backup" color={colors.primary} subtitle="Keep your business records safe." />
              
              <View style={[styles.row, { borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 16, marginBottom: 16 }]}>
                <View style={styles.iconBox}>
                  <Cloud size={20} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.label, { color: colors.foreground }]}>Automatic Backups</Text>
                  <Text style={[styles.desc, { color: colors.mutedForeground }]}>Daily or weekly secure cloud backups</Text>
                </View>
                <Switch
                  value={status.settings.enabled}
                  onValueChange={handleToggleAuto}
                  trackColor={{ true: colors.primary, false: colors.border }}
                  disabled={updateSettings.isPending}
                />
              </View>

              {status.settings.enabled && (
                <View style={styles.freqRow}>
                  <TouchableOpacity
                    style={[
                      styles.freqBtn,
                      status.settings.frequency === 'daily' ? { backgroundColor: colors.primary, borderColor: colors.primary } : { borderColor: colors.border }
                    ]}
                    onPress={() => handleChangeFreq('daily')}
                    disabled={updateSettings.isPending}
                  >
                    <Text style={[
                      styles.freqText,
                      status.settings.frequency === 'daily' ? { color: '#fff' } : { color: colors.foreground }
                    ]}>Daily</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.freqBtn,
                      status.settings.frequency === 'weekly' ? { backgroundColor: colors.primary, borderColor: colors.primary } : { borderColor: colors.border }
                    ]}
                    onPress={() => handleChangeFreq('weekly')}
                    disabled={updateSettings.isPending}
                  >
                    <Text style={[
                      styles.freqText,
                      status.settings.frequency === 'weekly' ? { color: '#fff' } : { color: colors.foreground }
                    ]}>Weekly</Text>
                  </TouchableOpacity>
                </View>
              )}

              <View style={[styles.infoCard, { backgroundColor: colors.muted }]}>
                <Clock size={16} color={colors.mutedForeground} />
                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Last Successful Backup</Text>
                  <Text style={[styles.infoValue, { color: colors.foreground }]}>
                    {status.lastSuccessful?.completedAt ? new Date(status.lastSuccessful.completedAt).toLocaleString('en-NG') : 'Never'}
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                style={[styles.btn, { backgroundColor: colors.primary }]}
                onPress={() => {
                  if (pendingCount > 0) {
                    Alert.alert('Finish syncing first', `${pendingCount} record${pendingCount === 1 ? ' is' : 's are'} still waiting to sync. Keep the app open and try again shortly.`);
                    return;
                  }
                  runBackup.mutate();
                }}
                disabled={runBackup.isPending}
              >
                {runBackup.isPending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Database size={18} color="#fff" />
                    <Text style={styles.btnText}>Back Up Now</Text>
                  </>
                )}
              </TouchableOpacity>
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(100).springify()} style={[styles.section, { backgroundColor: colors.card }]}>
              <SectionHeader title="Export Data" color="#8B5CF6" subtitle="Download your records for your own use." />
              
              <View style={styles.exportGrid}>
                <TouchableOpacity
                  style={[styles.exportBtn, { borderColor: colors.border }]}
                  onPress={() => handleExport('csv', 'all')}
                  disabled={!!downloading}
                >
                  {downloading === 'all-csv' ? <ActivityIndicator size="small" color="#8B5CF6" /> : <Download size={18} color="#8B5CF6" />}
                  <Text style={[styles.exportBtnText, { color: colors.foreground }]}>All (CSV)</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.exportBtn, { borderColor: colors.border }]}
                  onPress={() => handleExport('xlsx', 'all')}
                  disabled={!!downloading}
                >
                  {downloading === 'all-xlsx' ? <ActivityIndicator size="small" color="#8B5CF6" /> : <FileText size={18} color="#8B5CF6" />}
                  <Text style={[styles.exportBtnText, { color: colors.foreground }]}>All (Excel)</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.exportBtn, { borderColor: colors.border }]}
                  onPress={() => handleExport('json', 'all')}
                  disabled={!!downloading}
                >
                  {downloading === 'all-json' ? <ActivityIndicator size="small" color="#8B5CF6" /> : <Database size={18} color="#8B5CF6" />}
                  <Text style={[styles.exportBtnText, { color: colors.foreground }]}>All (JSON)</Text>
                </TouchableOpacity>
              </View>

              <View style={{ marginTop: 16 }}>
                <Text style={[styles.label, { color: colors.foreground, marginBottom: 8 }]}>Specific Records (CSV)</Text>
                <View style={styles.exportGrid}>
                  <TouchableOpacity
                    style={[styles.exportBtn, { borderColor: colors.border }]}
                    onPress={() => handleExport('csv', 'products')}
                    disabled={!!downloading}
                  >
                    {downloading === 'products-csv' ? <ActivityIndicator size="small" color="#8B5CF6" /> : <Download size={16} color="#8B5CF6" />}
                    <Text style={[styles.exportBtnText, { color: colors.foreground }]}>Products</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.exportBtn, { borderColor: colors.border }]}
                    onPress={() => handleExport('csv', 'customers')}
                    disabled={!!downloading}
                  >
                    {downloading === 'customers-csv' ? <ActivityIndicator size="small" color="#8B5CF6" /> : <Download size={16} color="#8B5CF6" />}
                    <Text style={[styles.exportBtnText, { color: colors.foreground }]}>Customers</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(150).springify()} style={[styles.section, { backgroundColor: colors.card }]}>
              <SectionHeader title="Import Data" color="#10B981" subtitle="Bring data in from other systems." />
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: '#ECFDF5', borderColor: '#10B981', borderWidth: 1 }]}
                onPress={handleImportProducts}
                disabled={importProducts.isPending}
              >
                {importProducts.isPending ? (
                  <ActivityIndicator size="small" color="#10B981" />
                ) : (
                  <>
                    <Upload size={18} color="#10B981" />
                    <Text style={[styles.btnText, { color: '#10B981' }]}>Import Products (CSV/XLSX)</Text>
                  </>
                )}
              </TouchableOpacity>
            </Animated.View>

            {status.history && status.history.length > 0 && (
              <Animated.View entering={FadeInDown.delay(200).springify()} style={[styles.section, { backgroundColor: colors.card }]}>
                <SectionHeader title="Backup History" color={colors.primary} />
                {status.history.slice(0, 5).map((b, i) => (
                  <View key={b.id} style={[styles.historyRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.historyDate, { color: colors.foreground }]}>
                        {b.completedAt ? new Date(b.completedAt).toLocaleString('en-NG') : 'Pending'}
                      </Text>
                      <Text style={[styles.historyDesc, { color: colors.mutedForeground }]}>
                        {b.recordCount} records • {b.status}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.restoreBtn, { backgroundColor: colors.muted }]}
                      onPress={() => handleRestore(b.id)}
                      disabled={restoreBackup.isPending}
                    >
                      <RotateCcw size={14} color={colors.foreground} />
                      <Text style={[styles.restoreBtnText, { color: colors.foreground }]}>Restore</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </Animated.View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  topBarTitle: { color: '#fff', fontSize: 17, fontFamily: 'Inter_600SemiBold' },
  scroll: { padding: 16 },
  section: {
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  iconBox: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: '#F3F4F6',
    alignItems: 'center', justifyContent: 'center',
    marginRight: 12,
  },
  label: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  desc: { fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 2 },
  freqRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  freqBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  freqText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
  },
  infoLabel: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  infoValue: { fontSize: 14, fontFamily: 'Inter_700Bold', marginTop: 2 },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 10,
    gap: 8,
  },
  btnText: { color: '#fff', fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  exportGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  exportBtn: {
    flex: 1,
    minWidth: '30%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderRadius: 10,
    gap: 6,
  },
  exportBtnText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  historyDate: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  historyDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  restoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    gap: 4,
  },
  restoreBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
});
