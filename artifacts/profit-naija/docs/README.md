# Accounting workflow guide

`accounting-workflow.html` is a self-contained, downloadable explanation.
`accounting-workflow.svg` is the standalone vector diagram. Neither is imported
by the app, and generating them does not write any business records.

Regenerate and validate with Node 24 from the project root:

```sh
node --experimental-strip-types artifacts/profit-naija/docs/build-accounting-workflow.mjs
```

The generator checks its fictional example against the current mobile formula
library before writing either asset. It also checks the zero-opening-stock
management P&L convention so its caveat cannot silently disappear.

Update the explanations when accounting behaviour changes. The example passing
does not establish mobile/web parity, complete user-journey coverage or store
approval. The guide distinguishes current report assumptions from required
verification. The Google Play status is the supplied 6 October 2026 snapshot,
not a live Console connection.

Open the HTML file in a browser to read it or use Print → Save as PDF. On small
screens the diagram scrolls horizontally and the accompanying text reflows.
