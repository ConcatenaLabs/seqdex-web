# SeqDEX site

The standalone SeqDEX website for the Sequentia testnet, live at
https://sequentiatestnet.com/dex/. Non-custodial by construction: it has no
wallet of its own and drives everything through the wallet you connect: the
Sequentia web wallet open in another tab, Ambra mobile (or any wallet on a phone that
pairs the same way) paired by a QR code, Ambra browser (repo `sequentia-extension`,
`window.sequentia`), or your own Sequentia Core, Lightning node and leaf wallet
through the [`sequentia-connect`](https://github.com/ConcatenaLabs/sequentia-connect)
daemon on your computer, which asks you in its terminal before anything is signed.
Each wallet asks you in its own window or screen. The connect button lets you choose;
DESIGN.md, "Wallets", describes the interface all of them speak, and the extension's
`doc/PAIRING.md` how it travels to a wallet in another tab or on a phone.

The site has two views, and follows the wallet's mode to choose between them.

**The default view** is a trading terminal. **Markets** (`index.html`) lists every
market priced every way round, grouped by asset, with its last price, 24-hour change
and volume: choose an asset to price every market in it, or search. **A pair**
(`market.html?pair=GOLD-USDX`) shows its price chart (candles or a line, ranges from
a day to all, indicators, or the book's depth), the book and recent trades, an order
ticket for market and limit orders, and your open orders, trades and history. The
wallet chooses how each trade settles and shows what is given, got and paid before
anything is signed; an order rests until it is filled, and what is left of it can be
taken back once its time has run out. **Portfolio** (`portfolio.html`) shows one total
in US dollars and each asset's one figure, your orders and your trades.

**The developer view**, shown while the wallet is in developer mode, adds one room
per way of settling, each with its own book, unmerged:

- **LNDEX**: pure Lightning swaps; both legs of every trade run through
  Lightning channels (maker's and taker's), including cross-chain BTC.
- **On-chain DEX**: atomic on-chain settlement, covenant resting orders,
  cross-chain BTC over on-chain contracts, OpenAMP restricted assets.
- **Confidential DEX**: blinded transactions, Sequentia assets only.
- **Channel marketplace**: per-asset channel state and inbound liquidity
  for LNDEX traders.
- **Leaves room**: on-chain orders filled from leaves held in an operator's tree,
  and orders placed on the chain from them (DESIGN.md, "Leaves room").
- **Pools room**: the makers' pools of the on-chain book, each side at what its coin
  holds above its reserve, and the clearing rounds at their one price (DESIGN.md,
  "Pools room").

`?view=developer` or `?view=default` on any page sets the view for this browser
whatever the wallet's mode; `?view=wallet` follows the wallet again.

The web wallet ([`sequentia-web-wallet`](https://github.com/ConcatenaLabs/sequentia-web-wallet))
carries the trading composer; this site is the market-first venue that reads the
same relays.

Architecture and settlement designs: [DESIGN.md](DESIGN.md).
Wallet protocol: [`sequentia-extension/doc/PROVIDER.md`](https://github.com/ConcatenaLabs/sequentia-extension/blob/master/doc/PROVIDER.md).

Static ES modules, no bundler, no framework. Serve the directory as-is;
deployed behind Caddy at `/dex/` on the testnet box.

Tests: `node --test`.

Run it locally: the relays, the asset registry and the prices answer only their own
origin (`https://sequentiatestnet.com`), so a copy served from elsewhere reads them
through a proxy that serves the checkout at `/dex/` and passes every other path to the
box under its own name. The extension repository's stand-in box does this in its
upstream mode (`test/market/box.mjs`, `upstream`); Chromium reaches it as the real host
with `--host-resolver-rules="MAP sequentiatestnet.com 127.0.0.1:<port>"` and
`--ignore-certificate-errors`. Wallet features need a wallet: the extension, a running
`sequentia-connect` that allows the site's origin, a paired phone, or the web wallet on
the same origin; the web wallet's `tooling/live-proxy.mjs --dex <this checkout>` serves
both at one origin in front of the testnet.
