import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orient, pairsOf, mergeBook, rowOf, remaindersOf, seriesOf, priceAtoms, amountAtoms, estimate } from '../shared/market-book.js';

const G = 'aa'.repeat(32), U = 'bb'.repeat(32), S = 'cc'.repeat(32);
const price = { [G]: 4146, [U]: 1, [S]: 0.37 };
const tick = { [G]: 'GOLD', [U]: 'USDX', [S]: 'tSEQ', BTC: 'BTC' };
const refPrice = (h) => price[h] ?? null, tickerOf = (h) => tick[h] || h;

test('a pair has one orientation: BTC quotes, else the asset worth less per unit', () => {
  assert.deepEqual(orient(U, G, refPrice, tickerOf), { base: G, quote: U });
  assert.deepEqual(orient('BTC', G, refPrice, tickerOf), { base: G, quote: 'BTC' });
  assert.deepEqual(orient('dd'.repeat(32), 'ee'.repeat(32), () => null, (h) => (h[0] === 'd' ? 'ZED' : 'ABC')), { base: 'ee'.repeat(32), quote: 'dd'.repeat(32) });
});

test('each pair is listed once, BTC pairs first, interactive-only and confidential markets aside', () => {
  const pairs = pairsOf({
    chainMarkets: [{ base: G, quote: U }, { base: U, quote: G }, { base: S, quote: U }, { base: G, quote: 'BTC' }, { base: G, quote: S, confidential: true }],
    instantMarkets: [{ base: G, quote: 'BTC' }, { base: G, quote: U }],
    refPrice, tickerOf,
  });
  assert.deepEqual(pairs.map((p) => tickerOf(p.base) + '/' + tickerOf(p.quote)), ['GOLD/BTC', 'GOLD/USDX', 'USDX/tSEQ']);
});

const cov = (sell, want, locked, num, den, extra = {}) => ({
  offer_id: 'o' + Math.random(), offer_asset: sell, want_asset: want, offer_amount: String(locked), expires_at_unix: '0',
  covenant: { rate_num: String(num), rate_den: String(den), covenant_txid: extra.txid || '1'.repeat(64), covenant_vout: extra.vout ?? 0 }, ...extra,
});

test('covenant orders both ways round make one book: asks and bids', () => {
  const opts = { base: G, quote: U, basePrec: 8, quotePrec: 8 };
  const ask = rowOf(cov(G, U, 50_000_000, 4146, 1), opts);
  assert.equal(ask.side, 'ask'); assert.equal(ask.price, 4146); assert.equal(ask.size, 50_000_000n); assert.equal(ask.total, 50_000_000n * 4146n);
  // Sells 4000 U for G at 1/4000: a bid of 1 G at 4000.
  const bid = rowOf(cov(U, G, 4000n * 100_000_000n, 1, 4000), opts);
  assert.equal(bid.side, 'bid'); assert.equal(bid.price, 4000); assert.equal(bid.size, 100_000_000n);
  // Interactive, cross-chain and other pairs' offers are not rows here.
  assert.equal(rowOf({ offer_asset: G, want_asset: U, same_chain: {}, offer_amount: '1' }, opts), null);
  assert.equal(rowOf(cov(S, U, 10, 1, 1), opts), null);
});

test('the merged book groups levels and runs depth; a re-rested order shows what it holds', () => {
  const opts = { base: G, quote: U, basePrec: 8, quotePrec: 8 };
  const a1 = cov(G, U, 100, 4146, 1, { txid: '2'.repeat(64) }), a2 = cov(G, U, 50, 4146, 1, { txid: '3'.repeat(64) }), a3 = cov(G, U, 10, 4200, 1);
  const b1 = cov(U, G, 4000 * 30, 1, 4000);
  const book = mergeBook([a3, b1, a1, a2], opts);
  assert.deepEqual(book.asks.map((l) => [l.price, l.size, l.orders, l.depth]), [[4146, 150n, 2, 150n], [4200, 10n, 1, 160n]]);
  assert.deepEqual(book.bids.map((l) => [l.price, l.size]), [[4000, 30n]]);
  // a1 was filled down to 40, resting again at 2222…:1.
  const rem = remaindersOf([{ txid: '4'.repeat(64), rest: { vout: 1 }, remainder: 40, state: 'final' }]);
  const a1moved = { ...a1, covenant: { ...a1.covenant, covenant_txid: '4'.repeat(64), covenant_vout: 1 } };
  const after = mergeBook([a1moved, a2], { ...opts, remainders: rem });
  assert.equal(after.asks[0].size, 90n);
  assert.equal(remaindersOf([{ txid: '4'.repeat(64), rest: { vout: 1 }, remainder: 40, state: 'undone' }]).size, 0);
});

test('against BTC the book is the instant makers\' quotes only', () => {
  const opts = { base: G, quote: 'BTC', basePrec: 8, quotePrec: 8 };
  const pure = { offer_id: 'p', pair: { base_asset: G, quote_asset: 'BTC' }, trade_dir: 'TRADE_DIR_SELL', base_amount: '100000000', want_amount: '4900000', offer_amount: '100000000', lightning: { ln_direction: 2 }, expires_at_unix: '0' };
  const sub = { ...pure, lightning: { ln_direction: 0 } };
  const r = rowOf(pure, opts);
  assert.equal(r.side, 'ask'); assert.equal(r.price, 0.049);
  assert.equal(rowOf(sub, opts), null);
});

test('the chart turns the reversed market\'s trades round', () => {
  const s = seriesOf({ trades: [{ ts: 2, price: 4100 }], reversed: [{ ts: 1, price: 1 / 4000 }], basePrec: 8, quotePrec: 8 });
  assert.deepEqual(s.map((p) => [p.t, Math.round(p.price)]), [[1, 4000], [2, 4100]]);
});

test('typed prices and amounts become atoms exactly', () => {
  assert.equal(priceAtoms('4146', 8), 414_600_000_000n);
  assert.equal(priceAtoms('0.5', 2), 50n);
  assert.throws(() => priceAtoms('1e3', 8), /valid price/);
  assert.throws(() => priceAtoms('0.001', 2), /at most 2 decimals/);
  assert.equal(amountAtoms('0.2', 8), 20_000_000n);
  assert.throws(() => amountAtoms('0', 8), /above zero/);
});

test('the form\'s estimate walks the levels from the best', () => {
  const book = { asks: [{ price: 4146, size: 100n, total: 414600n }, { price: 4200, size: 100n, total: 420000n }], bids: [] };
  assert.deepEqual(estimate(book, 'buy', 150n), { base: 150n, quote: 414600n + 210000n, short: false });
  assert.equal(estimate(book, 'buy', 500n).short, true);
  assert.equal(estimate(book, 'sell', 1n).short, true);
});
