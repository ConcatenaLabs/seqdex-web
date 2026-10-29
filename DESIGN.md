# SeqDEX site: architecture

The standalone SeqDEX website. It has no wallet of its own: every key
operation goes through the wallet the person connects, behind one interface
(see "Wallets" below): the Sequentia web wallet in another tab of this origin, a
wallet on a phone paired by a QR code (Ambra mobile), Ambra browser (the extension,
repo `sequentia-extension`, `window.sequentia`), or the person's own Sequentia
Core, Lightning node and leaf wallet through the `sequentia-connect` daemon on
their computer (repo `sequentia-connect`). All speak the same protocol:
[`sequentia-extension/doc/PROVIDER.md`](https://github.com/ConcatenaLabs/sequentia-extension/blob/master/doc/PROVIDER.md).
The site has two views. The default view is one market per pair, its book merged
from the orders the wallet can settle in one step, and the wallet chooses how each
trade settles; it names no rail. The developer view, shown while the wallet is in
developer mode, adds one room per way of settling, each with its own book, never
merged, colour-coded so the user always knows which settlement world they are in.

## The default view: markets, a pair, the portfolio (accent: neutral blue)

Three pages, a trading terminal on Sequentia's market data. They are what every visitor
sees unless the wallet is in developer mode or the site's override says otherwise
(`?view=developer|default|wallet`, kept in the browser). Their words are in the
default-mode contract (`sequentia-web-wallet/docs/DEFAULT_MODE.md`, "SeqDEX").

- **Markets** (`index.html`, `js/markets-page.js`): the Tickers panel
  (`js/tickers-panel.js` on `shared/tickers.js`), from the relay's one answer for every
  market (`/seqob/v1/tickers`). Every market is two rows, its base priced in its quote
  and the other way round, each figure turned round with it (last, high, low, 24-hour
  change); volume is in the reference currency, the same for both rows. "Priced in" is the
  shared asset chooser (`shared/asset-picker.js`, copied from the web wallet: a search box,
  your assets first with their balances, Any pinned on top). "Priced in Any"
  lists every asset once, BTC first and then by volume, with a row for each asset it
  trades against; choosing an asset prices every market in it. A search matches either
  side; favourites are kept in the browser; "You hold" keeps the assets the wallet
  holds. A row opens its pair. A link to a pair on this page
  (`index.html?pair=GOLD-USDX`) opens the pair's page.
- **A pair** (`market.html?pair=GOLD-USDX`, `js/market-page.js`): the pair's last
  price and day beside the Tickers panel (compact), the chart, the book and recent
  trades, the order ticket, and your orders. The pair is shown the way round the link
  names it, and ⇄ turns it round. A market's own direction (`orient`) is the
  wallets' (`sequentia-web-wallet` `swap.js`, `canonicalPair`): the quote is the
  pair's unit of account, BTC first, then the fiat stablecoins (USDX, then EURX, then
  the bridged ones); between two other assets, the one whose id sorts first is the
  base. The makers post in it, and every order goes to the wallet in it; a pair shown
  the other way round reads the book in the market's direction and turns it round
  for display (`invertBook`), and its ticket asks for what is spent on a buy and
  received on a sale, so every amount the wallet is asked for is exact.
- **The book.** Only orders the wallet settles in one step, merged
  (`shared/market-book.js`): between two Sequentia assets, the orders on `/seqob`
  that fill with their makers away (covenant orders on the chain, and orders resting
  as leaves in an operator's tree, offer member `resting_leaf`, each at its relay's
  live size, `statuses[i].active_amount`), read both ways round (an order selling the quote for the base, listed on
  the reversed market, is a bid); and the two sides of a maker's pool (offer member
  `pool`), the ask at the pool's ask and the bid at its bid, each at what its coin holds
  above its reserve, once the wallet settles a pool's fill (its provider lists
  `dexFillPool`); against BTC, the pure-Lightning quotes on
  `/seqob-pln` (`ln_direction` 2 or 3). Interactive, cross-chain on-chain and
  confidential offers stay in the rooms. After a partial fill the relay keeps listing
  a covenant order at the amount it was signed with; the book reads what the order
  holds from the relay's fill records (the order rests again at the fill's output
  2k+1). Levels are grouped by price, with their running depth.
- **Prices and the chart.** A price is the last trade, in the quote's own units; the
  book's spread line reads "Spread <amount> · <percent> · Mid <price>"; a book whose best bid
  is above its best ask is shown as it is. Totals are in the reference currency. The
  ticker, the candles and the trades come from the relay in the pair's direction
  (`/seqob/v1/market/{base}/{quote}/ticker|candles|trades`; that relay follows the
  others, so every rail's trades are in them). The chart (`shared/chart.js`) shows
  the price as candles or a step line over 1D, 1W, 1M, 3M, 1Y or All, with volume and
  the indicators of `shared/indicators.js`, or the book's depth.
- **Trading.** `placeOrder` with the type, side, amount and, for a limit order, the
  price; the wallet reads the book itself, picks the orders, settles each, and rests
  what a limit order does not fill. Order types and options beyond market and limit
  (an auction, post only, nothing left resting, the smallest fill, when an order can
  be taken back) are drawn only when the wallet lists them in `getCapabilities`'
  `features`. The ticket's estimate is the page's own walk of the book (what fills now
  and what rests) and says the wallet shows the exact amounts.
- **Your orders** (`js/orders-view.js`, on the pair's page and the portfolio):
  `getOrders`, polled. Open orders show how much is filled, and either a button to
  take back what is left (`cancelOrder`), once its time has run out, or from when it
  can be. Trades are one row each, "Swapped … for …", reading "Sent" until the relay
  calls them final (the block certified and its Bitcoin anchor buried), then
  "Settled". Order history lists the orders filled or taken back.
- **Portfolio** (`portfolio.html`, `js/portfolio-page.js`): one total in the reference
  currency, then each asset's one figure wherever the wallet holds it (its `total`
  where the wallet lists `balances-total`), BTC first, then by value, with what is
  still arriving; your orders and trades; and the trades as a CSV file.
- **Phone.** One column; the ticket opens as a sheet from Buy and Sell at the foot
  of the screen; the Tickers panel opens from the pair's name.
- **No rail on the page.** No word of a room, rail, operator, covenant or atom; the
  extension's `test/market/drive.mjs` reads the page's words in user mode.

## The developer view's surfaces

On a pair's page the developer view adds the routes by name: above the book, "Settles
in one step" (the default view's merged book) and one chip per route of it (on-chain
covenant, resting leaf, pools; Lightning against BTC), each showing that route's own
book alone, with its count of orders; and a Route column on recent trades (the relay's
`rail` of each). The rooms below keep the routes the one-step book leaves out, each with
its own book, never merged.

### 1. LNDEX (accent: violet)
Pure Lightning swaps only. No submarine or mixed rails: **both legs of every
trade travel over Lightning channels, and both maker and taker need live
channels with capacity in the right directions** before an order can be
placed or filled. Cross-chain with BTC is native here (asset over Sequentia
Lightning against BTC over testnet4 Lightning), plus asset-to-asset trades
with both legs on Sequentia Lightning.

- Book: the `/seqob-pln` relay (:9965). LNDEX shows only offers whose
  `lightning.ln_direction` is 2 or 3 (the two pure-Lightning directions). The
  same relay also carries submarine offers (`ln_direction` 0 and 1) and
  sub-asset offers (4 and 5); those are filtered out here by definition of
  the surface (`shared/book.js`, `pureLnOnly`). The relay's per-market
  counts (`/v1/markets`, `n_orders`) add all three families together, so the
  LNDEX market list is not taken from them: each market's book is read once
  (`pureLnMarkets`), markets with no live pure-Lightning offer are dropped,
  and the count shown is the pure-Lightning one. The index tile uses the
  same scan.
- Settlement: hold-invoice pairs. The site sends `dexSwapLn` (fill one
  order), `dexMarketOrder` or `dexPlaceLimit` (the wallet walks the book and
  rests the remainder) and polls `dexJobResult`; the wallet creates and pays
  the invoices on the user's own hosted SeqLN nodes (device co-signed,
  non-custodial) behind one approval. Instant and final when it settles:
  nothing on-chain, no Bitcoin-reorg risk. The extension also broadcasts a
  `dexProgress` event (`{ text, job }`) to every connected page for every
  job it runs; the site paints a tick only for a job it started itself,
  into that ticket's status line, and stops the moment the job's result is
  in, so another tab's progress never overwrites an outcome here.
- Prerequisite surfaced in the UI: per-asset channel state (spendable and
  receivable) from the wallet. A user without inbound liquidity for the
  asset they are buying is routed to the Channels page.

### 2. On-chain DEX (accent: gold)
On-chain settlement on Sequentia, with cross-chain BTC via on-chain HTLCs,
and OpenAMP restricted assets.

- Book: the `/seqob` relay (:9955): same-chain interactive offers
  (`SameChainTerms`), funded covenant resting orders (`CovenantTerms`,
  oversell-impossible, maker can be offline), and cross-chain offers
  (`CrossChainTerms`, `quote_asset == 'BTC'`).
- Settlement is delegated whole to the wallet: the site sends
  `dexFillOnchain` (`mount: 'chain'`) with the order id and size, the wallet
  recomputes the fill from the relay, composes and signs the swap PSET (or
  the covenant FILL spend) and shows one approval. The site never sees UTXOs
  or PSETs. Cross-chain (BTC-quoted) rows are listed, but the wallet refuses
  to fill them yet (`dexFillOnchain` rejects cross-chain offers).
- OpenAMP: restricted-asset legs settle as enclave transfers (policy-server
  co-signed) coordinated with the on-chain counterleg; the wallet's
  never-blind-sign rule applies unchanged.

### 3. Confidential DEX (accent: teal)
Blinded Sequentia transactions only; no BTC anywhere (Bitcoin has no
confidential transactions, so a cross leg would unblind the trade).

- The relay protocol anticipated this surface: `pair.confidential` exists on
  every market, and `SameChainTerms.maker_blinding_pub` lets the taker blind
  the maker's output. Confidential markets are the same pairs with
  `confidential: true`.
- Book: a dedicated relay mount `/seqob-conf` (same `seqobd` binary, new
  instance) so confidential and transparent books never mix.
- Settlement: same-chain interactive settlement with confidential
  (`tsqb1…`) addresses and blinded PSETs, via `dexFillOnchain` with
  `mount: 'conf'`. The wallet signs blinded PSETs today; decoding them for
  the approval screen is a wallet-side follow-up.

### 4. Channels marketplace (accent: violet, serves the LNDEX)
Inbound liquidity for LNDEX traders: you cannot RECEIVE an asset over
Lightning without inbound capacity in that asset.

- Phase one (working now): the LSP sells JIT inbound liquidity. The page
  reads the user's per-asset channel state from the wallet and lets them
  request inbound capacity (`lnRequestInbound`), which provisions or tops up
  a channel toward the user's own hosted node.
- Phase two (planned; the `/seqob-chan` relay mount is not yet deployed and
  no page reads it): a P2P channel-offer book: sellers post priced offers
  (asset, capacity, fee, minimum duration); a buyer pays over Lightning or
  on-chain and the seller's node opens the channel.

### 5. Leaves room (developer mode; accent: lime)
On-chain orders filled from leaves, and orders placed on the chain from them.
A leaf is a coin held in an operator's tree off the chain; the site's copy
speaks only of leaves, rounds and the operator (this checkout is served as the
site, its documents with it). The room
exists only while the wallet says it is in developer mode (`getWalletMode`,
then `modeChanged`): its page draws nothing of itself otherwise, and its link
in the navigation and its tile on the index page are added by script only in
developer mode, so no public page names it.

- Book: the on-chain relay (`/seqob`), covenant orders and orders resting as
  leaves in an operator's tree, in the pairs the operator the wallet joined serves
  both assets of. A resting order is shown with its operator (key and URL), its order
  id and its locator: the coin it rests at now and what that coin holds, which the
  relay moves at every fill; and its fill records (taker `operator_tree`, keyed by
  the operator's transfer id, final with the round the order rests on). Only one of
  the joined operator is offered a Fill button (`getLeafOperator`, which
  also names the operator: its key, its server, its forfeit window and each
  asset's fees). Each order is joined with the pair's fill records
  (`/v1/market/{base}/{quote}/fills`, `shared/leaf-room.js`).
- Settlement: the wallet's `takeOrder`, handed the relay's offer. The wallet's
  leaf library finds the order on its own node and prices the fill by the
  covenant's arithmetic; the operator's round spends the order, pays the maker
  on the chain and pays the taker a leaf. The wallet hands the take's forfeits
  over by itself within the operator's window, and takes the leaf once the round
  is final.
- States of a fill, from the wallet (`getLeafTakes`, `leafTake`) and the
  relay's record of the round: submitted, round built, forfeits handed over, in
  a round (in a block), final (the block certified and its Bitcoin anchor
  buried), undone (the block left the chain; it counts again once mined again),
  voided (the forfeits did not come in time; the coins are the taker's again).
- What is not offered: the relay keeps listing an order filled whole until the
  fill is final (held from its own matching), and lists the rest of an order
  filled in part at its new outpoint as soon as the fill is in a block. The
  room offers an order only when no fill in a block holds it, and shows the
  reason in the row otherwise: "filled whole … not final" or "rests again after
  a fill … not final". The operator's round would refuse both in any case (it
  takes an order only once its transaction is final).
- Placing: `placeOrderFromLeaves` with the amount sold, the amount wanted for
  all of it (the room reduces the two to the covenant's rate), the smallest
  fill and the refund time. The order rests on the chain with its maker
  offline once its round is final; the wallet lists it on the relay itself, and
  the room shows where it rests, its listing and its fills (`getLeafOrders`).
  Fees are paid in the asset each operation moves (the asset sold for a
  placement, the asset paid for a take), as the operator's schedule asks.
- Values: atoms, with the reference currency where a price is known.

### 6. Pools room (developer mode; accent: gold)
The makers' pools of the on-chain book and the clearing rounds, read only
(`pools.html`, `js/pools-room.js`, joined in `shared/pool-room.js`). Like the
leaves room it exists only while the wallet says it is in developer mode, and its
link and tile are added by script then.

- Pools: a pool (offer member `pool`, the template seqdex/pool) is a maker's two
  coins, one of each asset, which anyone fills on the chain at its quotes and only
  the maker's key withdraws. It lists two offers on `/seqob`, its ask (base for
  quote) and its bid (quote for base, on the reversed market), each at what its own
  coin holds above that coin's reserve (`statuses[i].active_amount`). The room shows
  each pool once: its ask and bid, what each side holds above its reserve, its
  reserves and minimum lot, the coins it rests at and its maker's key.
- Clearing rounds: `/seqob/v1/rounds`, each round at the one price its last output
  publishes, with the round orders it filled (offer member `round_order`), the pools
  it moved, and where it stands: in a block, final (certified, its Bitcoin anchor
  buried), or undone by a Bitcoin reorganisation, in which case the orders and the
  pools are listed again where they rested before.
- The room places nothing: a round order is filled only in a round its clearer
  signs, and a pool by the pool's own fill.

## What the site is

Static ES modules, no bundler, no framework (house style). Served at
`https://sequentiatestnet.com/dex/`. Pages: `index.html`, `market.html` and
`portfolio.html` (the default view's markets, a pair and the portfolio), and in
the developer view `rooms.html` (the room chooser), `lndex.html`,
`onchain.html`, `confidential.html`, `channels.html` and the developer-mode
`leaves.html`, over a
shared core (`shared/`): provider glue, asset metadata (registry + prices),
relay book client, UI tokens.

The wallet drives everything sensitive. The site builds and displays;
the wallet signs, pays, and holds keys. With no wallet there, the site runs
read-only and says how to get one.

The markets, a pair and the portfolio are one page (`js/shell.js`): `index.html`,
`market.html` and `portfolio.html` serve the same shell, and each is a view of it. A link
to one of them, a row of the Tickers panel, and back and forward change the address with
the History API and swap the view; no page loads, so the header and the wallet's
connection stay put. A view starts its timers and subscriptions in a lifecycle
(`js/life.js`) that ends them when it leaves the screen. What the wallet holds, its
orders, its features and its mode are read once for every view (`js/store.js`, one poll),
so an order placed on a pair is in the portfolio at once.

The wallet is connected once. The choice is kept in the browser and the wallet is asked
silently again on the next load and in every new tab (`getAccounts`; Ambra browser,
Sequentia Core on this computer and a paired phone keep their session, the web wallet its
approval while its page is open); Disconnect in the wallet menu forgets it in every tab,
and no wallet is asked again until one is connected. The web wallet knows the site by
its folder (`siteKey`, `/dex/`), so one approval covers every view.

## Wallets

`shared/connectors.js` holds the connectors and `shared/provider.js` is the one
door every page goes through. A connector is anything that speaks the provider
protocol: `request(method, params)`, `on(event, fn)`, and a `getCapabilities`
answer whose `provider` names it. Pages never ask which wallet is behind the
door; they ask what it serves (`supports(method)`, or `rails()`, which groups the
method list: the account, the default view's market orders, on-chain fills,
instant swaps, Lightning pay and receive, inbound liquidity, leaves, orders
filled from leaves, orders resting as leaves, pools), and offer only that.

- **The extension** (`extension`): `window.sequentia`, which must answer
  `getCapabilities` with `provider: 'sequentia-wallet-extension'`. Every method
  this site calls.
- **Sequentia Core on this computer** (`local`): the `sequentia-connect` daemon
  at `http://127.0.0.1:7419` (another loopback port with `?local=<port>`, kept in
  the browser; `?local=default` clears it). Requests are `POST /v1/request
  {method, params}` with the session the daemon gave at connect in the
  `x-sequentia-session` header; events come from `GET /v1/events`, held open. It
  must answer `getCapabilities` with `provider: 'sequentia-connect'`. The daemon
  answers only the origins its owner allowed, and asks its owner in its own
  terminal before it signs or pays anything. It serves the account, the default
  view's market and limit orders between two Sequentia assets (covenant orders,
  filled and rested from the Core wallet), Lightning channels, invoices and
  payments (SeqLN or CLN), and in developer mode the leaf wallet's balances and
  receive requests.

- **The web wallet** (`webwallet`): the Sequentia web wallet open in another tab or
  window of this origin (`/wallet/`), over the `BroadcastChannel` named
  `sequentia-wallet` (the extension's `doc/PAIRING.md`, "Same origin"). It must
  answer `getCapabilities` with `provider: 'sequentia-web-wallet'`. The site says
  hello, talks to the one wallet page that answered first, and opens the wallet in a
  window of its own when none is open; the wallet page shows its owner the
  connection and each order in its own dialog. It serves the account and the
  default view's market and limit orders, settled as its Trade tab settles a trade.
- **A wallet on a phone** (`phone`): any wallet that pairs by the extension's
  `doc/PAIRING.md`, "Another device" (Ambra): the site shows a `nostrconnect://`
  pairing code with a one-time secret and the relays to meet on
  (`PAIR_RELAYS`), as a QR code and as a link for a wallet app on the same phone;
  the wallet that answers the secret is paired, and every request after that is an
  encrypted event between the two keys only (NIP-44, through
  `shared/vendor/nostr-tools.js`). Its `getCapabilities` names it (no fixed
  `provider`: the pairing binds it). The pairing is kept in the browser until it is
  forgotten from the chooser or the wallet sends `disconnect`.

The connect button opens a chooser with all four, each marked Ready, Connected,
Not open (the web wallet), Pair or Paired (a phone), Not installed or Not
running. The choice is kept in the browser; with none made, the extension is
used when it is installed, else the daemon once it answers. The daemon's port is
looked for only when it is the chosen wallet, while no wallet is there at all,
and when the chooser opens: a page whose wallet is the extension never knocks on
it. The chooser's words follow the default-mode contract
(`sequentia-web-wallet/docs/DEFAULT_MODE.md`, "Connect").

## Provider protocol dependencies

Live in `sequentia-extension` (`doc/PROVIDER.md` is the contract; changes
land there first, then in `sequentia-connect` for what it serves):

- Shipped and used here: `connect`, `getAccounts`, `getNetwork`,
  `getBalances`, in the default view `placeOrder`, `getOrders` and `cancelOrder`
  (a wallet that does not list them in `getCapabilities` is asked to update), `lnChannels` (per-asset spendable/receivable, the LNDEX
  gate), `lnRequestInbound` (the marketplace phase-one purchase), and the
  DEX methods the wallet settles behind one approval: `dexSwapLn`,
  `dexMarketOrder`, `dexPlaceLimit`, `dexFillOnchain`, `dexJobResult`; in the
  leaves room, `getLeafOperator`, `getLeafBalances`, `takeOrder`,
  `getLeafTakes`, `placeOrderFromLeaves`, `getLeafOrders`, `restOrder`,
  `fillRestingOrder`, `cancelRestingOrder`, `getRestingOrders`, and the
  `modeChanged`, `leafTake` and `leafArrived` events.
- Also called, silently: `getCapabilities`, before any other method, so the
  site refuses a wallet that does not identify itself as the connector it was
  chosen as (`sequentia-wallet-extension`, `sequentia-connect` or
`sequentia-web-wallet`; a phone by its pairing's secret; any page
  script can define a `window.sequentia` of its own);
  and `getWalletMode` on every page, which decides whether the leaves room's
  link and tile are drawn.
- Shipped in the provider but deliberately not wrapped here: `getAddress`,
  `getUtxos`, `signPset`, `signMessage`, `broadcast`, `createInvoice`,
  `payInvoice`. The site never sees a UTXO, composes a PSET or handles an
  invoice; the wallet does all of that behind the `dex*` methods, and
  `shared/provider.js` exposes only the methods the site actually calls so
  nothing sensitive can be reached from here by accident.
- Planned: BTC HTLC fills for on-chain cross swaps, blinded PSET decode for
  the confidential approval screen.

## Design language

Dark chassis (near-black, one family with the extension popup), Sequentia
gold reserved for the on-chain surface and brand marks. Surface accents:
LNDEX and Channels violet, on-chain gold, confidential teal, leaves lime; the
default view settles every way at once and wears a neutral blue. Type: Space
Grotesk for display and UI, IBM Plex Mono for numbers, books, and
identifiers. The accent system is informational, not decorative: it encodes
which settlement world the user is standing in.

Charts are drawn with TradingView Lightweight Charts, vendored unmodified in
`shared/vendor/lightweight-charts` (Apache-2.0; a page that shows a chart shows its
NOTICE with a link to TradingView, and each chart keeps the library's
attribution logo). `shared/chart.js` holds the price chart (candles or a step
line, with volume and indicators in panes of their own), the depth chart (the
library's price-axis chart, the book sampled at even price steps), the ranges
(1D, 1W and 1M as the wallets have them, then 3M, 1Y and All), a seven-day line
for lists, and the colours: buys green, sales amber, as in the wallets. An
interval with no trade holds the last price, so a quiet market's empty days keep
their place on the time axis. `shared/indicators.js` computes moving averages,
EMA, Bollinger bands, VWAP and RSI from the relay's candles. The library is
passed in rather than imported, so a wallet draws the same charts from its own
copy of the one file.
