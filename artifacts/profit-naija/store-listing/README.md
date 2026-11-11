# ProfitNaija mobile discovery package

This is store-listing copy, not an Expo/EAS configuration or a store API payload.
It does not change the installed app name, bundle IDs, billing plans, builds or
release tracks. It has not been uploaded to either store.

## Apply the copy

### Google Play Console

1. Open the app with package `com.profitnaija.app`.
2. Open **Main store listing** and select the existing English listing language.
3. Paste `googlePlay.title` into the app name and
   `googlePlay.shortDescription` into the short description.
4. Paste `fullDescription` into the full description.
5. Review the suggested Business category and choose only relevant tags that
   actually exist in the console. Do not add competitor names or unrelated tags.
6. Check the privacy link and support website against the URLs in the bundle.
7. Review the changes through the console's normal approval process.

Metadata changes do not make a closed-test app publicly discoverable. Verify
production approval, country availability and device eligibility separately.
Do not promote an unverified build to production just to improve discovery.

### App Store Connect

1. Open the existing app with bundle ID `com.profitnaija.app`.
2. Select the existing supported English localization; the copy is written for
   Nigerian business owners, not a new unsupported language code.
3. Paste the name, subtitle, keywords and promotional text into their fields.
4. Paste `fullDescription` into the description.
5. Review the suggested categories, privacy URL, support URL and marketing URL.
6. Submit metadata through the app's normal version/review workflow.

The promotional text is conversion copy, not an App Store ranking-keyword field.
Neither the app's package nor its installed name needs to change.

## Screenshot capture plan

The ordered plan is in `metadata.json`. The first three screenshots explain the
core benefits: profit visibility, recording sales and stock tracking.

- Capture the actual current native app UI, not invented screens or web-only UI.
- Use a dedicated synthetic business account with consistent accounting data.
- Never expose a real customer's contacts, finances or identifying details.
- Keep the existing ProfitNaija branding and make captions readable on a phone.
- Match each caption to the screen shown. Do not imply all tools are included in
  every subscription tier.
- Follow the current screenshot sizes in the official linked store guidelines.
- Use the app's real icon and upload compliant Google Play preview assets,
  including the feature graphic. These images still need to be captured/uploaded.

## Website links

The current website badges lead to generic store homepages. Replace them only
after the actual ProfitNaija listing URLs are supplied and verified.

Do not invent an Apple numeric app ID. Do not send Android visitors to a guessed
package URL that currently returns 404. Also confirm visibility from Nigeria.
Once verified, use the actual app listing URLs for every download badge.

## Reviews and measurement

- Ask for honest feedback, not positive ratings or paid reviews.
- Do not gate access or rewards on a rating. Do not direct unhappy users away
  from the store while prompting only satisfied users to rate it.
- After launch, compare store impressions, product-page visits and installs.
- Test one major screenshot/copy change at a time after collecting enough real
  traffic. The proposed keywords are feature-based suggestions, not measured
  search-volume or ranking claims.

## Validation and downloadable guide

Run from the project root:

```sh
node artifacts/profit-naija/store-listing/build-guide.mjs
```

This checks field lengths and app identity before generating the self-contained
HTML copy guide in this folder. The JSON is the single source of truth.
