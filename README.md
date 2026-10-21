# SeqDEX site

The standalone SeqDEX website for the Sequentia testnet, live at
https://sequentiatestnet.com/dex/. Non-custodial by construction: it has no
wallet of its own and drives everything through the Ambra browser extension
(repo `sequentia-extension`, `window.sequentia`).

Three trading surfaces, deliberately separate (no unified order book), plus
a channel marketplace:

- **LNDEX**: pure Lightning swaps; both legs of every trade run through
  Lightning channels (maker's and taker's), including cross-chain BTC.
- **On-chain DEX**: atomic on-chain settlement, covenant resting orders,
  cross-chain BTC over on-chain contracts, OpenAMP restricted assets.
- **Confidential DEX**: blinded transactions, Sequentia assets only.
- **Channel marketplace**: per-asset channel state and inbound liquidity
  for LNDEX traders.

A wallet in developer mode also sees the leaves room: on-chain orders filled
from leaves held in an operator's tree, and orders placed on the chain from
them (DESIGN.md, "Leaves room").

The web wallet ([`sequentia-web-wallet`](https://github.com/ConcatenaLabs/sequentia-web-wallet))
carries the unified trading terminal; this site is the split-surface
alternative that reads the same relays.

Architecture and settlement designs: [DESIGN.md](DESIGN.md).
Wallet protocol: [`sequentia-extension/doc/PROVIDER.md`](https://github.com/ConcatenaLabs/sequentia-extension/blob/master/doc/PROVIDER.md).

Static ES modules, no bundler, no framework. Serve the directory as-is;
deployed behind Caddy at `/dex/` on the testnet box.

Tests: `node --test`.

Run it locally: `python3 -m http.server 8080` in this directory and open
http://localhost:8080/index.html. Books, the asset registry and prices are
fetched from sequentiatestnet.com when the page is served from any other
origin (`shared/meta.js`, `BASE`); wallet features need the extension.
