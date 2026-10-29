# SeqDEX site

The standalone SeqDEX website for the Sequentia testnet, live at
https://sequentiatestnet.com/dex/. Non-custodial by construction: it has no
wallet of its own and drives everything through the wallet you connect: the
Sequentia browser extension (repo `sequentia-extension`, `window.sequentia`), or
your own Sequentia Core, Lightning node and leaf wallet through the
[`sequentia-connect`](https://github.com/ConcatenaLabs/sequentia-connect) daemon on
your computer, which asks you in its terminal before anything is signed. The
connect button lets you choose; DESIGN.md, "Wallets", describes the interface both
speak.

The site has two views, and follows the wallet's mode to choose between them.

**The default view** (`index.html`) is one market per pair of assets: pick a pair,
read its book (every order the wallet can settle in one step, merged, with its
depth) and its price chart, and trade with one form and one button, a market order
or a limit order. The wallet chooses how each trade settles and shows what is given,
got and paid, each in the reference currency, before anything is signed. Your open
orders and your history sit under the book: an order rests until it is filled, and
what is left of it can be taken back once its time has run out. Prices and totals are
in the reference currency throughout, and BTC pairs come first.

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
`--ignore-certificate-errors`. Wallet features need the extension or a running
`sequentia-connect` that allows the site's origin.
