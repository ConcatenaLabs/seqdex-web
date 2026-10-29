// The default view's market: one market per pair of assets, its book merged from every
// order the wallet can settle in one step, and its trades for the price chart. Pure:
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

// The pairs of the default view, each once, from the relays' market lists: every
// Sequentia pair of the on-chain book, and every pair against BTC the instant makers
// quote. BTC pairs come first, then the rest by ticker.
export function pairsOf({ chainMarkets = [], instantMarkets = [], tickerOf }) {
  const seen = new Map();
  const add = (a, b) => {
    if (!a || !b || a === b) return;
    const p = orient(a, b, tickerOf);
    const k = p.base + '/' + p.quote;
    if (!seen.has(k)) seen.set(k, { ...p, key: k });
  };
  for (const m of chainMarkets) if (m.base !== 'BTC' && m.quote !== 'BTC' && !m.confidential) add(m.base, m.quote);
  for (const m of instantMarkets) if (m.base === 'BTC' || m.quote === 'BTC') add(m.base, m.quote);
  const label = (p) => String(tickerOf(p.base)) + '/' + String(tickerOf(p.quote));
  return [...seen.values()].sort((x, y) => {
    const bx = x.quote === 'BTC' ? 0 : 1, by = y.quote === 'BTC' ? 0 : 1;
    return bx - by || label(x).localeCompare(label(y));
  });
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

// The price chart's points: the trades of both orientations, as quote units per base
// unit, oldest first. A trade on the reversed market is turned round.
export function seriesOf({ trades = [], reversed = [], basePrec, quotePrec }) {
  const scale = Math.pow(10, basePrec - quotePrec);
  const pts = [];
  for (const t of trades) if (t.price > 0) pts.push({ t: Number(t.ts), price: Number(t.price) * scale });
  for (const t of reversed) if (t.price > 0) pts.push({ t: Number(t.ts), price: (1 / Number(t.price)) * scale });
  return pts.sort((a, b) => a.t - b.t);
}

// The one price a market shows, in its list entry and in its header alike: the middle
// of the book while it has buyers and sellers; otherwise the last trade; otherwise none
// (a reference price that no order or trade backs is never shown as the market's).
// `kind` names it in plain words: 'mid' (the middle of the book) or 'last' (the last
// trade). `series` is seriesOf's points, oldest first.
export function marketPrice(book, series) {
  if (book && book.best && book.best.ask != null && book.best.bid != null) {
    return { price: (book.best.ask + book.best.bid) / 2, kind: 'mid' };
  }
  const last = (series || []).at(-1);
  if (last && last.price > 0) return { price: last.price, kind: 'last', at: last.t };
  return null;
}
export const PRICE_WORDS = { mid: 'middle of the book', last: 'last trade' };

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
