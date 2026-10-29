// The default view's market: one market per pair of assets, its book merged from every
// order the wallet can settle in one step. Pure:
// the page fetches, this file arranges. Every amount stays in atoms (BigInt) until the
// page formats it; prices are quote units per base unit (numbers, for display only).
//
// Sources, read the same way whichever way round a maker listed an order:
//  - between two Sequentia assets, the orders on the on-chain book's relay that fill
//    with their makers away: covenant orders on the chain, and orders resting as leaves
//    in an operator's tree (`resting_leaf`), each listed at what its coin holds now. An
//    order selling the base for the quote is an ask; one selling the quote for the base,
//    listed on the reversed market, is a bid;
//  - against BTC, the quotes of the makers who settle instantly (the pure-Lightning
//    offers, `lightning.ln_direction` 2 or 3);
//  - the two sides of a maker's pool (`pool`), each at what its coin holds above its
//    reserve, when the wallet settles a pool's fill (`pools`): the pool's ask sells
//    its base at the ask, its bid buys it at the bid.
// Other offer families (interactive, cross-chain, confidential) are not in this view:
// each needs a step or a choice the default view does not offer.

import { poolRowOf } from './pool-room.js';

const big = (v) => BigInt(v ?? 0);

// The orientation of a pair, the same as the wallets' (sequentia-web-wallet swap.js
// `canonicalPair`), so a pair reads one way on every surface: the quote is the
// pair's unit of account, BTC first, then the fiat stablecoins in QUOTE_RANK's
// order; between two other assets, the one whose id sorts first is the base. The
// Sequence token is one of those other assets. Returns { base, quote }. The
// relay's makers post in this direction too.
export const QUOTE_RANK = Object.freeze({ USDX: 900, EURX: 890, 'EURC.E': 885, FEEUSD: 880, USDT: 870, USDC: 865, 'USDC.E': 864, USD: 860 });
export function quoteRank(h, tickerOf = (x) => x) {
  if (h === 'BTC') return 1000;
  return QUOTE_RANK[String(tickerOf(h) || '').toUpperCase()] || 400;
}
export function orient(a, b, tickerOf = (h) => h) {
  const ra = quoteRank(a, tickerOf), rb = quoteRank(b, tickerOf);
  if (ra !== rb) return ra > rb ? { base: b, quote: a } : { base: a, quote: b };
  return String(a) < String(b) ? { base: a, quote: b } : { base: b, quote: a };
}

// What each covenant order of a pair still holds, from the relay's fill records (`fills`
// of either orientation): after a partial fill the order rests again at the fill's
// output 2k+1, and the relay's listing keeps the amount it was signed with. Returns a map
// "txid:vout" -> remainder atoms.
export function remaindersOf(fills) {
  const m = new Map();
  for (const f of fills || []) {
    if (f.state === 'undone' || !f.rest) continue;
    m.set(`${f.txid}:${f.rest.vout}`, big(f.remainder));
  }
  return m;
}

// One order as a row of the merged book, or null when it is not one the default view
// takes. `price` is quote units per base unit; `size` base atoms; `total` quote atoms.
export function rowOf(o, { base, quote, basePrec, quotePrec, remainders = new Map(), pools = false, nowSec = Math.floor(Date.now() / 1000) }) {
  if (Number(o.expires_at_unix || 0) > 0 && Number(o.expires_at_unix) <= nowSec) return null;
  const scale = Math.pow(10, basePrec - quotePrec);
  if (quote === 'BTC') {
    const ln = o.lightning;
    const d = ln ? Number(ln.ln_direction ?? -1) : -1;
    if (d !== 2 && d !== 3) return null;
    if (o.pair && (o.pair.base_asset !== base || o.pair.quote_asset !== quote)) return null;
    const size = big(o.base_amount);
    if (size <= 0n) return null;
    const bid = o.trade_dir === 'TRADE_DIR_BUY';
    const total = big(bid ? o.offer_amount : o.want_amount);
    return { side: bid ? 'bid' : 'ask', size, total, price: (Number(total) / Number(size)) * scale, id: o.offer_id };
  }
  if (o.pool) {
    // A side of a maker's pool, at what its coin holds above its reserve (the relay's
    // live size). Listed only when the wallet settles a pool's fill (`pools`).
    return pools ? poolRowOf(o, { base, quote, basePrec, quotePrec }) : null;
  }
  const ct = o.covenant || o.resting_leaf;
  if (!ct) return null;
  const num = big(ct.rate_num), den = big(ct.rate_den);
  if (num <= 0n || den <= 0n) return null;
  let locked;
  if (o.resting_leaf) {
    // What the coin it rests at holds now: the relay's live size (statuses[i]), which
    // is 0 while its operator cannot be asked, else the locator the relay moves at
    // every fill.
    locked = big(o._active ?? ct.value);
  } else {
    const at = `${ct.covenant_txid}:${Number(ct.covenant_vout || 0)}`;
    locked = remainders.has(at) ? remainders.get(at) : big(o.offer_amount);
  }
  if (locked <= 0n) return null;
  const sells = String(o.offer_asset || '').toLowerCase(), wants = String(o.want_asset || '').toLowerCase();
  if (sells === base && wants === quote) {
    // An ask: `locked` base for ceil(locked * num / den) quote.
    const total = (locked * num + den - 1n) / den;
    return { side: 'ask', size: locked, total, price: (Number(num) / Number(den)) * scale, id: o.offer_id };
  }
  if (sells === quote && wants === base) {
    // A bid: `locked` quote for ceil(locked * num / den) base.
    const size = (locked * num + den - 1n) / den;
    return { side: 'bid', size, total: locked, price: (Number(den) / Number(num)) * scale, id: o.offer_id };
  }
  return null;
}

// The merged book: asks cheapest first, bids dearest first, orders at one price
// grouped into one level, each level with its running depth (base atoms).
export function mergeBook(offers, opts) {
  const rows = (offers || []).map((o) => rowOf(o, opts)).filter(Boolean);
  const level = (side, cmp) => {
    const byPrice = new Map();
    for (const r of rows.filter((x) => x.side === side)) {
      const k = r.price.toPrecision(10);
      const l = byPrice.get(k) || { price: r.price, size: 0n, total: 0n, orders: 0 };
      l.size += r.size; l.total += r.total; l.orders += 1;
      byPrice.set(k, l);
    }
    const out = [...byPrice.values()].sort(cmp);
    let run = 0n;
    for (const l of out) { run += l.size; l.depth = run; }
    return out;
  };
  const asks = level('ask', (a, b) => a.price - b.price);
  const bids = level('bid', (a, b) => b.price - a.price);
  return { asks, bids, best: { ask: asks[0] ? asks[0].price : null, bid: bids[0] ? bids[0].price : null } };
}

// A price typed by the user, in quote units per base unit, as quote atoms per whole base
// unit (the wallet's `price`). Digits and one point only.
export function priceAtoms(str, quotePrec) {
  str = String(str || '').trim();
  if (!/^\d+(\.\d+)?$/.test(str)) throw new Error('enter a valid price');
  const [i, f = ''] = str.split('.');
  if (f.length > quotePrec) throw new Error('the price takes at most ' + quotePrec + ' decimals');
  const v = BigInt(i) * 10n ** BigInt(quotePrec) + BigInt((f + '0'.repeat(quotePrec)).slice(0, quotePrec) || '0');
  if (v <= 0n) throw new Error('enter a price above zero');
  return v;
}

// An amount typed by the user, in base units, as base atoms.
export function amountAtoms(str, basePrec) {
  str = String(str || '').trim();
  if (!/^\d+(\.\d+)?$/.test(str)) throw new Error('enter a valid amount');
  const [i, f = ''] = str.split('.');
  if (f.length > basePrec) throw new Error('the amount takes at most ' + basePrec + ' decimals');
  const v = BigInt(i) * 10n ** BigInt(basePrec) + BigInt((f + '0'.repeat(basePrec)).slice(0, basePrec) || '0');
  if (v <= 0n) throw new Error('enter an amount above zero');
  return v;
}

// A smallest fill typed in the base of the pair as shown, as the canonical order's base atoms.
// When the view is the canonical market inverted, what is typed is the canonical quote: it
// becomes the canonical base it buys at the order's price (quote atoms per whole canonical
// base), rounded up so no fill is smaller than asked.
export function minFillAtoms(typedAtoms, inverted, priceAtoms, canonBasePrec) {
  const a = BigInt(typedAtoms);
  if (!inverted) return a;
  const p = BigInt(priceAtoms);
  if (p <= 0n) throw new Error('enter a price above zero');
  const unit = 10n ** BigInt(canonBasePrec);
  return (a * unit + p - 1n) / p;
}

// What a market order of `amount` base atoms would take from the book, for the form's
// estimate only (the wallet plans the trade itself): base atoms it reaches and the quote
// atoms they cost, walking levels from the best.
export function estimate(book, side, amount) {
  const levels = side === 'buy' ? book.asks : book.bids;
  let left = big(amount), base = 0n, quote = 0n;
  for (const l of levels) {
    if (left <= 0n) break;
    const take = left < l.size ? left : l.size;
    base += take;
    quote += (l.total * take) / l.size;
    left -= take;
  }
  return { base, quote, short: left > 0n };
}

// The book read the other way round: the quote becomes the base. An ask (base for quote)
// becomes a bid of the quote at the inverse price, its size the quote it would take; a
// bid becomes an ask. Each side is sorted best first, with its running depth again.
export function invertBook(book) {
  const flip = (l) => ({ ...l, price: l.price > 0 ? 1 / l.price : 0, size: l.total, total: l.size });
  const run = (levels) => { let d = 0n; for (const l of levels) { d += l.size; l.depth = d; } return levels; };
  const asks = run((book.bids || []).map(flip).sort((a, b) => a.price - b.price));
  const bids = run((book.asks || []).map(flip).sort((a, b) => b.price - a.price));
  return { asks, bids, best: { ask: asks[0] ? asks[0].price : null, bid: bids[0] ? bids[0].price : null } };
}

// What the wallet holds of each asset, one figure as the wallet shows it: its `total` where it
// answers one (getCapabilities' 'balances-total'), else its coins on the chain and its leaves
// (getBalances' `leaves`), and BTC on the chain and on the Bitcoin ark where the wallet answers
// that apart (`btc_ark`, Ambra mobile).
export function spendableOf(b) {
  if (b && b.total && typeof b.total === 'object') return { ...b.total };
  const out = {};
  if (b && (b.btc != null || b.btc_ark != null)) { try { out.BTC = (BigInt(b.btc || 0) + BigInt(b.btc_ark || 0)).toString(); } catch {} }
  for (const part of [b && b.assets, b && b.leaves]) {
    for (const [h, v] of Object.entries(part || {})) {
      try { out[h] = (BigInt(out[h] || 0) + BigInt(v || 0)).toString(); } catch {}
    }
  }
  return out;
}

// The other way round from `estimate`: the base a market order gets for paying (a buy) or must
// give to receive (a sale) `quoteAtoms` of the quote, walking the levels from the best.
// -> { base, quote, short } in atoms, short when the book holds less than asked.
export function estimateQuote(book, side, quoteAtoms) {
  const levels = side === 'buy' ? book.asks : book.bids;
  let left = BigInt(quoteAtoms ?? 0), base = 0n, quote = 0n;
  for (const l of levels) {
    if (left <= 0n) break;
    const take = left < l.total ? left : l.total;
    base += (l.size * take) / l.total;
    quote += take;
    left -= take;
  }
  return { base, quote, short: left > 0n };
}
