import assert from 'node:assert/strict';
import test from 'node:test';
import { canPurchaseGooglePlay, isWithinLegacyBillingGrace, resolveCheckoutStatus, usesPaystackManagement } from '@/lib/billingPolicy';
import {
  annualSavingsPercent,
  planFromRevenueCatProductIdentifier,
  intervalFromRevenueCatProductIdentifier,
  productChangeInfoForPlan,
  isRevenueCatTrialPeriod,
} from '@/lib/revenuecatHelpers';

test('recognizes RevenueCat trial periods separately from paid periods', () => {
  assert.equal(isRevenueCatTrialPeriod('TRIAL'), true);
  assert.equal(isRevenueCatTrialPeriod('trial'), true);
  assert.equal(isRevenueCatTrialPeriod('NORMAL'), false);
  assert.equal(isRevenueCatTrialPeriod(null), false);
});

test('maps only the supported Play products to plans', () => {
  assert.equal(planFromRevenueCatProductIdentifier('profitnaija_starter_monthly'), 'starter');
  assert.equal(planFromRevenueCatProductIdentifier('profitnaija_pro_monthly'), 'pro');
  assert.equal(planFromRevenueCatProductIdentifier('profitnaija_starter_yearly'), 'starter');
  assert.equal(planFromRevenueCatProductIdentifier('profitnaija_pro_yearly'), 'pro');
  assert.equal(planFromRevenueCatProductIdentifier('profitnaija_pro_yearly:annual'), 'pro');
  assert.equal(planFromRevenueCatProductIdentifier('profitnaija_pro_addon'), null);
  assert.equal(planFromRevenueCatProductIdentifier('other_starter_monthly'), null);
  assert.equal(planFromRevenueCatProductIdentifier('paid_access'), null);
});

test('maps products to intervals', () => {
  assert.equal(intervalFromRevenueCatProductIdentifier('profitnaija_starter_monthly'), 'monthly');
  assert.equal(intervalFromRevenueCatProductIdentifier('profitnaija_pro_yearly'), 'yearly');
  assert.equal(intervalFromRevenueCatProductIdentifier('profitnaija_pro_addon'), null);
  assert.equal(intervalFromRevenueCatProductIdentifier('paid_access'), null);
});

test('calculates yearly savings from the localized store product amounts', () => {
  assert.equal(annualSavingsPercent(5000, 48000), 20);
  assert.equal(annualSavingsPercent(10000, 96000), 20);
  assert.equal(annualSavingsPercent(5000, 54000), 10);
  assert.equal(annualSavingsPercent(null, 48000), null);
  assert.equal(annualSavingsPercent(5000, 65000), null);
});

test('uses explicit Play replacement semantics for upgrades and downgrades', () => {
  const upgrade = productChangeInfoForPlan('profitnaija_starter_monthly:monthly', 'starter', 'pro');
  const downgrade = productChangeInfoForPlan('profitnaija_pro_monthly:monthly', 'pro', 'starter');
  const intervalChange = productChangeInfoForPlan('profitnaija_pro_monthly:monthly', 'pro', 'pro');
  assert.equal(upgrade?.oldProductIdentifier, 'profitnaija_starter_monthly:monthly');
  assert.equal(upgrade?.replacementMode, 'CHARGE_PRORATED_PRICE');
  assert.equal(downgrade?.oldProductIdentifier, 'profitnaija_pro_monthly:monthly');
  assert.equal(downgrade?.replacementMode, 'DEFERRED');
  assert.equal(intervalChange?.replacementMode, 'DEFERRED');
  assert.equal(productChangeInfoForPlan('', 'pro', 'pro'), null);
});

test('fails closed for legacy Paystack access on cold start and after grace', () => {
  const now = Date.now();
  assert.equal(isWithinLegacyBillingGrace(null, now), false);
  assert.equal(isWithinLegacyBillingGrace(now, now + 60_000), true);
  assert.equal(isWithinLegacyBillingGrace(now, now + 6 * 60_000), false);
});

test('prevents Paystack-to-Play double billing and keeps legacy management on Paystack', () => {
  assert.equal(canPurchaseGooglePlay('paystack'), false);
  assert.equal(usesPaystackManagement('paystack'), true);
  assert.equal(canPurchaseGooglePlay('none'), true);
  assert.equal(canPurchaseGooglePlay('google_play'), true);
});

test('checkout retries unknown status and uses the newly verified provider', async () => {
  for (const source of ['google_play', 'paystack', 'grant/admin', 'none'] as const) {
    let refreshes = 0;
    const status = await resolveCheckoutStatus(
      { state: 'unknown', entitlementSource: 'none' as typeof source },
      async () => {
        refreshes++;
        return { state: 'none', entitlementSource: source };
      },
    );
    assert.equal(refreshes, 1);
    assert.equal(status.entitlementSource, source);
    assert.equal(canPurchaseGooglePlay(status.entitlementSource), source === 'none' || source === 'google_play');
  }
});

test('checkout does not refresh an already verified subscription', async () => {
  const known = { state: 'active', entitlementSource: 'google_play' };
  assert.equal(await resolveCheckoutStatus(known, async () => {
    throw new Error('Should not refresh');
  }), known);
});

test('checkout surfaces unresolved access checks without starting a purchase', async () => {
  const unknown = { state: 'unknown', accessReason: 'Server unavailable.' };
  await assert.rejects(resolveCheckoutStatus(unknown, async () => unknown), /Server unavailable.*No purchase was started/);
  await assert.rejects(resolveCheckoutStatus(unknown, async () => {
    throw new Error('Network unavailable');
  }), /Network unavailable/);
});

test('checkout stops waiting for a stalled status check', async () => {
  await assert.rejects(
    resolveCheckoutStatus({ state: 'unknown' }, () => new Promise(() => {}), 5),
    /timed out.*No purchase was started/,
  );
});