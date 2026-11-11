import { reportCrash } from '@/lib/crashReporting';

/**
 * Global crash reporter — must be the FIRST import in app/_layout.tsx.
 *
 * Sets up ErrorUtils before any other module is evaluated, so even a crash
 * inside an import statement (module-level code) gets logged to Metro's
 * terminal instead of silently showing Expo Go's "Something went wrong".
 */
if (typeof ErrorUtils !== 'undefined') {
  const prev = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
    try {
      console.error(
        '[CRASH]',
        isFatal ? 'FATAL' : 'NON-FATAL',
        '|',
        error?.name,
        '|',
        error?.message,
        '|',
        String(error?.stack ?? '')
          .split('\n')
          .slice(0, 10)
          .join(' -> '),
      );
      reportCrash(error, isFatal ? 'global_fatal_error' : 'global_nonfatal_error');
    } catch (_) {
      // eslint-disable-next-line no-console
      console.error('[CRASH] (logging failed)', String(error));
    }
    prev?.(error, isFatal);
  });
}
