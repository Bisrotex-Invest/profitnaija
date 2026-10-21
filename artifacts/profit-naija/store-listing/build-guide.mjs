import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

const metadata = JSON.parse(await readFile(new URL("./metadata.json", import.meta.url), "utf8"));
const native = JSON.parse(await readFile(new URL("../app.json", import.meta.url), "utf8")).expo;
assert.equal(metadata.app.androidPackage, native.android.package);
assert.equal(metadata.app.iosBundleIdentifier, native.ios.bundleIdentifier);
assert.equal(metadata.app.brand, native.name);

const length = value => [...value].length;
const fields = [
  ["Google Play title", metadata.googlePlay.title, 30],
  ["Google Play short description", metadata.googlePlay.shortDescription, 80],
  ["App Store name", metadata.appStore.name, 30],
  ["App Store subtitle", metadata.appStore.subtitle, 30],
  ["App Store keywords", metadata.appStore.keywords, 100],
  ["App Store promotional text", metadata.appStore.promotionalText, 170],
  ["Full description", metadata.fullDescription, 4000],
];
for (const [name, value, limit] of fields) {
  assert.ok(value && length(value) <= limit, `${name} exceeds ${limit} characters`);
  console.log(`PASS ${name}: ${length(value)}/${limit} characters`);
}
const keywords = metadata.appStore.keywords.split(",");
assert.equal(new Set(keywords).size, keywords.length);
assert.ok(keywords.every(keyword => keyword.length > 0 && keyword.trim() === keyword && !/\s/.test(keyword)));
const existingWords = `${metadata.appStore.name} ${metadata.appStore.subtitle}`.toLowerCase().split(/[^a-z0-9]+/);
assert.ok(keywords.every(keyword => !existingWords.includes(keyword)));
for (const value of Object.values(metadata.app).filter(value => String(value).startsWith("https://"))) {
  assert.equal(new URL(value).origin, "https://profitnaija.com");
}
assert.equal(metadata.screenshots.length, 7);

const escape = value => String(value).replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);
const field = (label, value, limit) => `<section><h3>${escape(label)} <small>${length(value)} / ${limit} characters</small></h3><pre>${escape(value)}</pre></section>`;
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ProfitNaija mobile store-listing copy</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f5f8f6;color:#173b2d;font:16px/1.6 Arial,sans-serif}
main{max-width:1000px;margin:auto;padding:40px 24px}h1{font-size:36px;line-height:1.2}h2{margin-top:36px}
h3{margin:0 0 12px;font-size:18px}small{display:block;color:#567366;font-size:13px;font-weight:normal}
section{background:white;border:1px solid #dbe6df;border-radius:12px;padding:22px;margin:16px 0}
pre{font:15px/1.65 Arial,sans-serif;white-space:pre-wrap;overflow-wrap:anywhere;margin:0;user-select:text}
a{color:#006b3f}.notice{border-left:4px solid #be8b31;background:#fff8e8;padding:18px}
table{width:100%;border-collapse:collapse;background:#fff}td,th{text-align:left;padding:14px;border-bottom:1px solid #dbe6df;vertical-align:top}
th{background:#e8f0eb}footer{margin-top:35px;font-size:14px;color:#567366}@media print{body{background:white}main{padding:0}section{break-inside:avoid}}
</style></head><body><main>
<p><strong>ProfitNaija · Mobile discovery</strong></p>
<h1>Store-ready listing copy</h1>
<p>English copy for Nigerian business owners. Select and copy the text below into the appropriate store fields.</p>
<div class="notice"><strong>Prepared, not published.</strong> This guide does not update your store listings.
Public Nigerian listings could not be verified during preparation. Release approval, actual store URLs and screenshots still need confirmation.
Never change release tracks or publish an unverified build merely to apply this copy.</div>
<h2>Google Play</h2>
${field("App name", metadata.googlePlay.title, 30)}
${field("Short description", metadata.googlePlay.shortDescription, 80)}
<p>Suggested category: <strong>${escape(metadata.googlePlay.suggestedCategory)}</strong>. Choose only genuinely relevant tags available in Play Console.</p>
<h2>Apple App Store</h2>
${field("App name", metadata.appStore.name, 30)}
${field("Subtitle", metadata.appStore.subtitle, 30)}
${field("Keywords", metadata.appStore.keywords, 100)}
${field("Promotional text", metadata.appStore.promotionalText, 170)}
<p>Suggested primary category: Business; optional secondary: Finance. Promotional text helps explain the app but is not a search-ranking keyword field.</p>
<h2>Full description · Both stores</h2>
${field("Description", metadata.fullDescription, 4000)}
<h2>Support and policy links</h2>
<ul>${["websiteUrl", "supportUrl", "privacyUrl", "termsUrl"].map(key =>
  `<li>${escape(key)}: <a href="${escape(metadata.app[key])}">${escape(metadata.app[key])}</a></li>`).join("")}</ul>
<h2>Screenshot plan · Images still to capture</h2>
<p>Use actual native-app screenshots with synthetic records, not real customer information. The first three images should explain the main benefits clearly.</p>
<table><thead><tr><th>Order / screen</th><th>Caption</th><th>Capture notes</th></tr></thead><tbody>
${metadata.screenshots.map(item => `<tr><td>${item.order}. ${escape(item.screen)}</td><td><strong>${escape(item.headline)}</strong></td><td>${escape(item.capture)}</td></tr>`).join("")}
</tbody></table>
<h2>Apply and launch carefully</h2><ol>
<li>In Play Console, open Main store listing for <strong>${escape(metadata.app.androidPackage)}</strong> and update the selected English language fields.</li>
<li>In App Store Connect, open the existing app with bundle ID <strong>${escape(metadata.app.iosBundleIdentifier)}</strong> and update a supported English localization through the normal review workflow.</li>
<li>Upload current, compliant native screenshots and the required store preview assets. Keep captions readable and figures internally consistent.</li>
<li>Confirm production approval and availability in Nigeria. Closed-test access is not public discovery.</li>
<li>Supply and verify the actual app listing URLs, then replace the website's generic download links. Do not guess an Apple app ID or publish a broken Android URL.</li>
<li>Encourage honest reviews without incentives, rating gates or filtering out unhappy users.</li>
<li>After launch, measure impressions, page visits and installs. Test one major copy or image change at a time; no ranking or search-volume results are promised.</li>
</ol><h2>Official references</h2><ul>
${metadata.sources.map(url => `<li><a href="${escape(url)}">${escape(url)}</a></li>`).join("")}
</ul><footer>App identity and field lengths are validated by the guide generator. No subscription prices, ratings or store IDs have been invented. Installed app branding and code are unchanged.</footer>
</main></body></html>`;
await writeFile(new URL("./copy-guide.html", import.meta.url), html);
console.log("PASS app identity, unique keywords and support URLs; generated copy-guide.html");
