import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANY, rowsOfTicker, tickerGroups, anchorsOf } from '../shared/tickers.js';

const G = 'aa'.repeat(32), U = 'bb'.repeat(32), S = 'cc'.repeat(32);
const tick = { [G]: 'GOLD', [U]: 'USDX', [S]: 'tSEQ', BTC: 'BTC' };
const tickerOf = (h) => tick[h] || h;
const meta = () => ({ precision: 8 });
const ref = { [G]: 4000, [U]: 1, [S]: 0.4, BTC: 100000 };
const refPrice = (h) => ref[h] ?? null;
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(b)), `${a} != ${b}`);

// GOLD/USDX: last 4000, opened at 3200 (+25%), 2 GOLD traded = 8000 USDX.
const gu = { base: G, quote: U, last: 4000, high_24h: 4100, low_24h: 3200, change_pct_24h: 25, volume_24h: 2e8, quote_volume_24h: 8000e8, trades_24h: 3, spark_7d: [0, 3200, 4000] };
const su = { base: S, quote: U, last: 0.4, change_pct_24h: 0, volume_24h: 1000e8, quote_volume_24h: 400e8, trades_24h: 1 };
const gb = { base: G, quote: 'BTC', last: 0.04, trades_24h: 0 };

test('a market is two rows, one the inverse of the other, figures included', () => {
  const [a, b] = rowsOfTicker(gu, meta, refPrice);
  assert.deepEqual([a.base, a.quote, a.last, a.high, a.low], [G, U, 4000, 4100, 3200]);
  assert.equal(a.volume, 8000);
  assert.deepEqual([b.base, b.quote], [U, G]);
  near(b.last, 1 / 4000); near(b.high, 1 / 3200); near(b.low, 1 / 4100);
  near(b.change, -20);                       // 1/3200 to 1/4000 is a 20% fall
  assert.equal(b.volume, a.volume);
  assert.deepEqual(b.spark.slice(0, 1), [0]); near(b.spark[1], 1 / 3200);
});

test('prices are in whole units, whatever the precisions', () => {
  const [a] = rowsOfTicker({ base: G, quote: U, last: 400, trades_24h: 0 }, (h) => ({ precision: h === G ? 2 : 8 }), refPrice);
  assert.equal(a.last, 400 * 10 ** (2 - 8));
});

test('Any: every base once, BTC first, then by volume; its quotes by market volume', () => {
  const g = tickerGroups([gu, su, gb], { meta, refPrice, tickerOf });
  assert.deepEqual(g.map((x) => tickerOf(x.base)), ['BTC', 'USDX', 'GOLD', 'tSEQ']);
  const usdx = g.find((x) => x.base === U);
  assert.deepEqual(usdx.rows.map((r) => tickerOf(r.quote)), ['GOLD', 'tSEQ']);
  assert.deepEqual(g[0].rows.map((r) => tickerOf(r.quote)), ['GOLD']);
});

test('an anchor shows every base priced in it, and any asset can be one', () => {
  const inU = tickerGroups([gu, su, gb], { anchor: U, meta, refPrice, tickerOf });
  assert.deepEqual(inU.map((x) => [tickerOf(x.rows[0].base), tickerOf(x.rows[0].quote)]), [['GOLD', 'USDX'], ['tSEQ', 'USDX']]);
  assert.ok(inU.every((x) => x.rows.length === 1));
  const inGold = tickerGroups([gu, su, gb], { anchor: G, meta, refPrice, tickerOf });
  assert.deepEqual(inGold.map((x) => tickerOf(x.base)), ['BTC', 'USDX']);
  assert.equal(inGold[0].rows[0].last, 1 / 0.04);
});

test('search matches the base or the quote', () => {
  const g = tickerGroups([gu, su, gb], { search: 'tse', meta, refPrice, tickerOf });
  assert.deepEqual(g.map((x) => [tickerOf(x.base), x.rows.map((r) => tickerOf(r.quote))]), [['USDX', ['tSEQ']], ['tSEQ', ['USDX']]]);
  assert.deepEqual(tickerGroups([gu], { search: 'zzz', meta, refPrice, tickerOf }), []);
});

test('a market with no trade has no change and no volume to show', () => {
  const [a] = rowsOfTicker(gb, meta, refPrice);
  assert.equal(a.change, null); assert.equal(a.volume, 0);
});

test('the anchors: Any, then every asset in a market, BTC first', () => {
  assert.deepEqual(anchorsOf([gu, su, gb], tickerOf).map((h) => (h === ANY ? ANY : tickerOf(h))), [ANY, 'BTC', 'GOLD', 'tSEQ', 'USDX']);
});

test('a market has one volume, valued in its unit of account, whichever way round it is read', async () => {
  const { volumeOf } = await import('../shared/tickers.js');
  // GOLD/USDX: 2 GOLD for 8000 USDX; GOLD's own reference price says 4100.
  const t = { base: G, quote: U, volume_24h: 2e8, quote_volume_24h: 8000e8, trades_24h: 1 };
  const flipped = { base: U, quote: G, volume_24h: 8000e8, quote_volume_24h: 2e8, trades_24h: 1 };
  const rp = (h) => ({ [G]: 4100, [U]: 1 })[h] ?? null;
  assert.equal(volumeOf(t, meta, rp, tickerOf), 8000);
  assert.equal(volumeOf(flipped, meta, rp, tickerOf), 8000);
  // Unpriced unit of account: the other side.
  assert.equal(volumeOf(t, meta, (h) => (h === G ? 4100 : null), tickerOf), 8200);
});
