import assert from 'node:assert/strict';
import test from 'node:test';
import { canPurchaseGooglePlay, isWithinLegacyBillingGrace, usesPaystackManagement } from '@/lib/billingPolicy';
import { planFromRevenueCatProductIdentifier, intervalFromRevenueCatProductIdentifier, productChangeInfoForPlan } from '@/lib/revenuecatHelpers';

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