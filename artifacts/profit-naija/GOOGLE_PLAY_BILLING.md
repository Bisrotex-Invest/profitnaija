# Google Play billing setup

The Android package is `com.profitnaija.app`. RevenueCat is configured with
the `paid_access` entitlement and these Play subscription products:

- `profitnaija_starter_monthly`, base plan `monthly-renewing`
- `profitnaija_starter_yearly`, base plan `yearly`
- `profitnaija_pro_monthly`, base plan `monthly`
- `profitnaija_pro_yearly`, base plan `yearly`

Complete these steps in Google Play Console before a production purchase can
be made:

1. Create or select the app whose package name is exactly
   `com.profitnaija.app`.
2. Create the four subscriptions with the product IDs and recurring base plans
   above. The original Starter Monthly `monthly` prepaid plan and the accidental
   `yearly` plan under Starter Monthly are inactive; do not reactivate them.
3. Set the NGN prices in Play Console. The app intentionally reads
   `priceString` from Google Play and does not calculate VAT or hardcode a
   native price.
4. Add and activate a **7-day free-trial offer** on each recurring base plan.
   Configure it for new-customer acquisition, with a 7-day free phase followed
   by the normal auto-renewing base-plan price. Google Play decides account
   eligibility and shows the trial in its checkout before confirmation; the
   app must not promise a trial when Play does not return one.
5. The Play service-account credentials are installed on the RevenueCat Play
   Store app (`ProfitNaija Android`) and validated for purchases, products,
   subscriptions, and base plans.
6. Add a license tester and publish the subscriptions to an internal or
   closed testing track. A product that is only saved as a draft cannot be
   returned by `getOfferings()`.
7. Upload an Android App Bundle signed with the same package and signing
   identity. Verify the release Firebase app has its SHA-1/SHA-256
   fingerprints.
8. RevenueCat's current `default` offering contains packages `starter`,
   `starter_yearly`, `pro`, and `pro_yearly`. All four products are attached
   to `paid_access`.

Web users and existing legacy Paystack subscriptions continue to use
Paystack. Android Play purchases are verified server-side through the
RevenueCat connector using the Firebase UID; the client never grants access
by setting `hasAccess`.