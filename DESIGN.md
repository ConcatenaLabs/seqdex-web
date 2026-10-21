# SeqDEX site: architecture

The standalone SeqDEX website. It has no wallet of its own: every key
operation goes through the Ambra browser extension (repo
`sequentia-extension`) via `window.sequentia` (protocol:
[`sequentia-extension/doc/PROVIDER.md`](https://github.com/ConcatenaLabs/sequentia-extension/blob/master/doc/PROVIDER.md)).
Unlike the web wallet's terminal there is **no unified order book**: the site is
deliberately split into three trading surfaces plus a channel marketplace,
and the UI color-codes each surface so the user always knows which
settlement world they are in.

## The four surfaces

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

- Book: the on-chain relay (`/seqob`), covenant orders only, in the pairs the
  operator the wallet joined serves both assets of (`getLeafOperator`, which
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

## What the site is

Static ES modules, no bundler, no framework (house style). Served at
`https://sequentiatestnet.com/dex/`. Pages: `index.html` (surface chooser),
`lndex.html`, `onchain.html`, `confidential.html`, `channels.html`, and the
developer-mode `leaves.html`, over a
shared core (`shared/`): provider glue, asset metadata (registry + prices),
relay book client, UI tokens.

The wallet drives everything sensitive. The site builds and displays;
the extension signs, pays, and holds keys. If `window.sequentia` is absent
the site runs read-only with an install prompt.

## Provider protocol dependencies

Live in `sequentia-extension` (`doc/PROVIDER.md` is the contract; changes
land there first):

- Shipped and used here: `connect`, `getAccounts`, `getNetwork`,
  `getBalances`, `lnChannels` (per-asset spendable/receivable, the LNDEX
  gate), `lnRequestInbound` (the marketplace phase-one purchase), and the
  DEX methods the wallet settles behind one approval: `dexSwapLn`,
  `dexMarketOrder`, `dexPlaceLimit`, `dexFillOnchain`, `dexJobResult`; in the
  leaves room, `getLeafOperator`, `getLeafBalances`, `takeOrder`,
  `getLeafTakes`, `placeOrderFromLeaves`, `getLeafOrders`, and the
  `modeChanged`, `leafTake` and `leafArrived` events.
- Also called, silently: `getCapabilities`, before any other method, so the
  site refuses a `window.sequentia` that does not identify itself as
  `sequentia-wallet-extension` (any page script can define that global);
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

## Phases

Status as of 2026-08-22:

- **P0 (shipped)**: site shell + all four pages with live books, wallet
  connect, per-asset channel state, working inbound-liquidity request.
- **P1 (shipped)**: LNDEX taker fills against the live pure-LN makers, end
  to end, plus market and limit tickets served by the wallet.
- **P2 (shipped)**: on-chain same-chain taker + covenant fills via
  `dexFillOnchain`.
- **P3 (open)**: cross-chain BTC (LN first, then on-chain HTLC). LNDEX
  already trades BTC over Lightning where a maker offers it; on-chain
  BTC-quoted fills are not served yet.
- **P4 (shipped)**: confidential relay mount + blinded settlement.
- **P5 (open)**: OpenAMP legs on the on-chain DEX; P2P channel-offer book.

## Design language

Dark chassis (near-black, one family with the extension popup), Sequentia
gold reserved for the on-chain surface and brand marks. Surface accents:
LNDEX and Channels violet, on-chain gold, confidential teal, leaves lime. Type: Space
Grotesk for display and UI, IBM Plex Mono for numbers, books, and
identifiers. The accent system is informational, not decorative: it encodes
which settlement world the user is standing in.
