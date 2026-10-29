# Vendored libraries

Single files, unchanged except where noted, so the site stays static ES modules with no build step.

| File | Upstream | Licence | Notes |
| --- | --- | --- | --- |
| `nostr-tools.js` | `nostr-tools` 2.25.1, `lib/nostr.bundle.js` (sha256 `9a414070c4965b1d152d79948f6a1ced9261d9108845972525d7cf649296ede9`) | Unlicense | one line appended, `export default NostrTools;`, so a module can import it |
| `lightweight-charts/` | `lightweight-charts` 5.2.1, `dist/lightweight-charts.standalone.production.mjs`, with its `LICENSE` and `NOTICE` (npm tarball sha1 `5a27ead719573607d4d3483ad2728c055ccea8fd`) | Apache-2.0, TradingView, Inc. | unchanged; a page showing a chart shows the notice and its link (`CHART_NOTICE`, `shared/chart.js`), and each chart keeps the attribution logo |
| `qrcode.mjs` | `qrcode-generator` 2.0.4, `dist/qrcode.mjs` (sha256 `ea91d7118a5395289170da848b7c6758b996163bfbccf312591ab65a4911b7c0`) | MIT, Copyright (c) 2009 Kazuhiko Arase | unchanged |

`nostr-tools` carries the pairing with a wallet on another device (NIP-44 encryption, event
signatures, the relay pool); `qrcode.mjs` draws the pairing code. Neither is loaded on a page
until a phone is paired or a pairing starts. Lightweight Charts draws the price and depth charts
(`shared/chart.js`).
