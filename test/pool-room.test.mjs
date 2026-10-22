import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayHex, poolsOf, poolRows, roundsOf } from '../shared/pool-room.js';
import { rowOf, mergeBook } from '../shared/market-book.js';

// Display ids, and the same ids in internal byte order as a pool's terms carry them.
const G = '11'.repeat(31) + 'ab', U = '22'.repeat(31) + 'cd';
const iG = displayHex(G), iU = displayHex(U);
const terms = { base: iG, quote: iU, bid_num: '9', bid_den: '10', ask_num: '11', ask_den: '10', min_lot: '1000',
  reserve_base: '1000000', reserve_quote: '1000000', maker_key: 'k', base_txid: 'a'.repeat(64), base_vout: 0,
  quote_txid: 'b'.repeat(64), quote_vout: 1 };
const ask = { offer_id: 'PA', offer_asset: G, want_asset: U, offer_amount: '10000000', _active: '550000', expires_at_unix: '0', pool: terms };
const bid = { offer_id: 'PB', offer_asset: U, want_asset: G, offer_amount: '9000000', _active: '1065000', expires_at_unix: '0', pool: terms };

test('display and internal byte order are each other reversed', () => {
  assert.equal(displayHex(displayHex(G)), G);
  assert.equal(iG.slice(0, 2), 'ab');
});

test('a pool is one entry from its two offers, each side at what its coin holds above its reserve', () => {
  const [p] = poolsOf([ask, bid, { offer_id: 'x', covenant: {} }]);
  assert.equal(p.base, G); assert.equal(p.quote, U);
  assert.equal(p.askSide.listed, 550000n); assert.equal(p.bidSide.listed, 1065000n);
  assert.equal(p.reserveBase, 1000000n); assert.equal(p.coins.base, 'a'.repeat(64) + ':0');
});

test('the pool lists as depth at its prices, either way round', () => {
  const [p] = poolsOf([ask, bid]);
  const rows = poolRows(p, { base: G, quote: U, basePrec: 8, quotePrec: 8 });
  const a = rows.find((r) => r.side === 'ask'), b = rows.find((r) => r.side === 'bid');
  assert.equal(a.price, 1.1); assert.equal(a.size, 550000n); assert.equal(a.total, 605000n);
  assert.equal(b.price, 0.9); assert.equal(b.total, 1065000n); assert.equal(b.size, 1183333n);
  const rev = poolRows(p, { base: U, quote: G, basePrec: 8, quotePrec: 8 });
  const ra = rev.find((r) => r.side === 'ask'), rb = rev.find((r) => r.side === 'bid');
  assert.ok(Math.abs(ra.price - 1 / 0.9) < 1e-12); assert.equal(ra.size, 1065000n);
  assert.ok(Math.abs(rb.price - 1 / 1.1) < 1e-12); assert.equal(rb.size, 605000n);
});

test('the default book takes a pool only when the wallet settles a pool', () => {
  const opts = { base: G, quote: U, basePrec: 8, quotePrec: 8 };
  assert.equal(rowOf(ask, opts), null);
  const book = mergeBook([ask, bid], { ...opts, pools: true });
  assert.equal(book.best.ask, 1.1); assert.equal(book.best.bid, 0.9);
  assert.equal(book.asks[0].size, 550000n);
  // A side listed at nothing is not a level.
  assert.equal(rowOf({ ...ask, _active: '0' }, { ...opts, pools: true }), null);
});

test('a round reads its price, its fills and the pools it moved, and says where it stands', () => {
  const [r] = roundsOf([{ txid: 't', price: { base: G, quote: U, n: '23', d: '20' }, clearer: 'c', state: 'undone', anchor_depth: 0,
    fills: [{ offer_id: 'RA1', filled: '4000000', credit: { value: '4600000', asset: U }, state: 'undone' }],
    pool_moves: [{ sell: true, base: '550000', quote: '605000', base_after: '1000000', quote_after: '2670000', state: 'undone' }] }]);
  assert.equal(r.n, 23n); assert.equal(r.d, 20n);
  assert.match(r.words, /undone/); assert.equal(r.fills[0].credited, 4600000n);
  assert.equal(r.moves[0].after[0], 1000000n);
});
