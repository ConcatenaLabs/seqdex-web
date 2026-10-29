import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orient, mergeBook, rowOf, remaindersOf, priceAtoms, amountAtoms, estimate } from '../shared/market-book.js';

const G = 'aa'.repeat(32), U = 'bb'.repeat(32), S = 'cc'.repeat(32);
const tick = { [G]: 'GOLD', [U]: 'USDX', [S]: 'tSEQ', BTC: 'BTC' };
const tickerOf = (h) => tick[h] || h;

test("a pair has the wallets' one orientation: BTC, then the fiat stablecoins, quote", () => {
  assert.deepEqual(orient(U, G, tickerOf), { base: G, quote: U });
  assert.deepEqual(orient('BTC', G, tickerOf), { base: G, quote: 'BTC' });
  assert.deepEqual(orient(U, 'BTC', tickerOf), { base: U, quote: 'BTC' });
  // The Sequence token is one asset among equals: USDX quotes it, as it quotes GOLD.
  assert.deepEqual(orient(S, U, tickerOf), { base: S, quote: U });
  // EURX quotes everything but BTC and USDX.
  const E = 'ee'.repeat(32);
  const t2 = (h) => (h === E ? 'EURX' : tickerOf(h));
  assert.deepEqual(orient(E, G, t2), { base: G, quote: E });
  assert.deepEqual(orient(E, U, t2), { base: E, quote: U });
  // The bridged stablecoins quote too: tSEQ / USDC.e, GOLD / EURC.e.
  const C = '11'.repeat(32), D = '12'.repeat(32);
  const t3 = (h) => (h === C ? 'USDC.e' : h === D ? 'EURC.e' : tickerOf(h));
  assert.deepEqual(orient(C, S, t3), { base: S, quote: C });
  assert.deepEqual(orient(D, G, t3), { base: G, quote: D });
  assert.deepEqual(orient(C, U, t3), { base: C, quote: U });
  // Two other assets: the id that sorts first is the base, whatever their prices.
  assert.deepEqual(orient(S, G, tickerOf), { base: G, quote: S });
  assert.deepEqual(orient(G, S, tickerOf), { base: G, quote: S });
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

test('a resting order is one more order of its market, at what its coin holds', () => {
  const A = 'aa'.repeat(32), B = 'bb'.repeat(32);
  const ask = { offer_id: 'r', offer_asset: A, want_asset: B, offer_amount: '600000', _active: '400000',
    resting_leaf: { rate_num: '2', rate_den: '1', value: '400000', coin: 'e2'.repeat(32) } };
  const bid = { offer_id: 'q', offer_asset: B, want_asset: A, offer_amount: '1000000',
    resting_leaf: { rate_num: '1', rate_den: '4', value: '800000', coin: 'e3'.repeat(32) } };
  const opts = { base: A, quote: B, basePrec: 0, quotePrec: 0 };
  assert.deepEqual(rowOf(ask, opts), { side: 'ask', size: 400000n, total: 800000n, price: 2, id: 'r' });
  assert.deepEqual(rowOf(bid, opts), { side: 'bid', size: 200000n, total: 800000n, price: 4, id: 'q' });
  assert.equal(rowOf({ ...ask, _active: '0' }, opts), null);
  const book = mergeBook([ask, bid], opts);
  assert.equal(book.best.ask, 2);
  assert.equal(book.best.bid, 4);
});

test('a book read the other way round: asks become bids at the inverse price, sizes swap', async () => {
  const { invertBook, spendableOf } = await import('../shared/market-book.js');
  const book = {
    asks: [{ price: 4000, size: 2n, total: 8000n, orders: 1 }, { price: 4100, size: 1n, total: 4100n, orders: 1 }],
    bids: [{ price: 3900, size: 3n, total: 11700n, orders: 2 }],
  };
  const inv = invertBook(book);
  assert.deepEqual(inv.asks.map((l) => [l.price, l.size, l.total, l.depth]), [[1 / 3900, 11700n, 3n, 11700n]]);
  assert.deepEqual(inv.bids.map((l) => [l.price, l.size, l.total]), [[1 / 4000, 8000n, 2n], [1 / 4100, 4100n, 1n]]);
  assert.equal(inv.bids[1].depth, 12100n);
  assert.equal(inv.best.bid, 1 / 4000); assert.equal(inv.best.ask, 1 / 3900);
  // The wallet's one figure per asset: its total where it answers one, else chain + leaves.
  assert.deepEqual(spendableOf({ total: { a: '5' }, assets: { a: '1' } }), { a: '5' });
  assert.deepEqual(spendableOf({ btc: '7', assets: { a: '1' }, leaves: { a: '2' } }), { BTC: '7', a: '3' });
});
