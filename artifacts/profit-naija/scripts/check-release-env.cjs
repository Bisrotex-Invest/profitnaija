// Stop store builds before bundling if their public production config is absent.
// Never print values: these checks also run in remote build logs.
if (
  process.env.EAS_BUILD_PROFILE !== 'production' ||
  process.env.EAS_BUILD_PLATFORM !== 'android'
) {
  process.exit(0);
}

const required = [
  'EXPO_PUBLIC_FIREBASE_API_KEY',
  'EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY',
  'EXPO_PUBLIC_DOMAIN',
  'EXPO_PUBLIC_ADMIN_EMAIL',
];

const problems = required
  .filter((name) => !process.env[name]?.trim())
  .map((name) => `Missing ${name}`);

const domain = process.env.EXPO_PUBLIC_DOMAIN?.trim();
if (domain) {
  try {
    const url = new URL(`https://${domain}`);
    if (
      url.host !== domain ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      url.port ||
      !url.hostname.includes('.') ||
      /(^|\.)(localhost|local|replit\.dev)$/i.test(url.hostname) ||
      /^\d+(?:\.\d+){3}$/.test(url.hostname)
    ) {
      problems.push('EXPO_PUBLIC_DOMAIN must be a production API hostname, not a preview URL');
    }
  } catch {
    problems.push('EXPO_PUBLIC_DOMAIN must be a valid production API hostname');
  }
}

const revenueCatKey = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY?.trim();
if (revenueCatKey && !revenueCatKey.startsWith('goog_')) {
  problems.push('EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY must be a Google Play public SDK key');
}

if (process.env.EXPO_GO_DEV === '1') {
  problems.push('EXPO_GO_DEV must not be enabled for a production native build');
}

if (/^(1|true)$/i.test(process.env.EXPO_PUBLIC_CRASHLYTICS_TEST || '')) {
  problems.push('EXPO_PUBLIC_CRASHLYTICS_TEST must not be enabled for a production build');
}

if (problems.length) {
  console.error(`Production build configuration is invalid:\n${problems.join('\n')}`);
  process.exit(1);
}

console.info('Production build configuration verified; values withheld.');
