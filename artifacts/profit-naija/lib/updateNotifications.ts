import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const LAST_VERSION_KEY = 'profitnaija:last-notified-app-version';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function registerUpdateNotifications(): Promise<void> {
  if (Platform.OS === 'web') return;

  const version = Constants.expoConfig?.version ?? 'unknown';
  const build = Platform.OS === 'android'
    ? String(Constants.expoConfig?.android?.versionCode ?? '')
    : String(Constants.expoConfig?.ios?.buildNumber ?? '');
  const fingerprint = `${version}:${build}`;
  const previousFingerprint = await AsyncStorage.getItem(LAST_VERSION_KEY);

  const currentPermission = await Notifications.getPermissionsAsync();
  let permission = currentPermission.status;
  if (permission === 'undetermined') {
    permission = (await Notifications.requestPermissionsAsync()).status;
  }

  if (permission === 'granted' && previousFingerprint && previousFingerprint !== fingerprint) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'ProfitNaija has been updated',
        body: `Version ${version} is now installed. Open the app to see the latest improvements.`,
        data: { type: 'app_update', version },
      },
      trigger: null,
    });
  }

  await AsyncStorage.setItem(LAST_VERSION_KEY, fingerprint);
}