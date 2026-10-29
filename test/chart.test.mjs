import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RANGES, rangeOf, fillCandles, priceFormat, barsOf, closesOf, depthSeries, niceStep, sparkSvg, CHART_NOTICE } from '../shared/chart.js';

test("the first three ranges are the wallets' own", () => {
  // sequentia-web-wallet market-view.js RANGES
  assert.deepEqual(RANGES.slice(0, 3).map((r) => [r.key, r.span, r.interval]),
    [['1D', 86400, 900], ['1W', 604800, 7200], ['1M', 2592000, 43200]]);
  for (const r of RANGES) assert.ok(r.interval >= 60 && r.interval <= 7 * 86400, 'the relay serves the interval');
  assert.equal(rangeOf('nope').key, '1M');
});

test('prices keep about six significant figures', () => {
  assert.deepEqual(priceFormat(4130.12), { type: 'price', precision: 2, minMove: 0.01 });
  assert.equal(priceFormat(0.374854).precision, 6);
  assert.equal(priceFormat(0.0000181371).precision, 10);
});

test('bars and the step line come from the candles, the line carried to now', () => {
  const cs = [{ t: 100, o: 1, h: 2, l: 0.5, c: 1.5, v: 3 }, { t: 200, o: 1.5, h: 1.5, l: 1, c: 1.2, v: 1 }];
  assert.deepEqual(barsOf(cs)[1], { time: 200, open: 1.5, high: 1.5, low: 1, close: 1.2 });
  assert.deepEqual(closesOf(cs, 500), [{ time: 100, value: 1.5 }, { time: 200, value: 1.2 }, { time: 500, value: 1.2 }]);
  assert.deepEqual(closesOf(cs, 200).length, 2);
});

test('niceStep is 1, 2 or 5 times a power of ten', () => {
  assert.equal(niceStep(0.3), 0.5);
  assert.equal(niceStep(3), 5);
  assert.equal(niceStep(0.000013), 0.00002);
  assert.equal(niceStep(100), 100);
});

test('depth is cumulative, sampled at even steps, each side ascending in price', () => {
  const bids = [{ price: 99, size: 1 }, { price: 98, size: 2 }];
  const asks = [{ price: 101, size: 3 }, { price: 102, size: 4 }];
  const d = depthSeries(bids, asks, { maxPoints: 4 });
  assert.equal(d.step, 1);   // 98 to 102 in at most four steps
  assert.deepEqual(d.bids.map((p) => [p.time, p.value]), [[98, 3], [99, 1]]);
  assert.deepEqual(d.asks.map((p) => [p.time, p.value]), [[101, 3], [102, 7]]);
  for (const s of [d.bids, d.asks]) for (let i = 1; i < s.length; i++) {
    assert.ok(s[i].time > s[i - 1].time);
    assert.ok(Math.abs(s[i].time - s[i - 1].time - d.step) < 1e-9, 'even steps');
  }
});

test('a crossed book is drawn as it is: the sides overlap', () => {
  const d = depthSeries([{ price: 102, size: 1 }], [{ price: 100, size: 1 }], { maxPoints: 10 });
  assert.ok(d.bids[d.bids.length - 1].time > d.asks[0].time);
});

test('depth keeps to maxPoints, and an empty book draws nothing', () => {
  const bids = Array.from({ length: 50 }, (_, i) => ({ price: 1 - i * 0.0003, size: 1 }));
  const asks = Array.from({ length: 50 }, (_, i) => ({ price: 1.0001 + i * 0.0003, size: 1 }));
  const d = depthSeries(bids, asks, { maxPoints: 20 });
  assert.ok(d.bids.length + d.asks.length <= 2 * 20 + 4, `${d.bids.length}+${d.asks.length}`);
  assert.deepEqual(depthSeries([], []), { bids: [], asks: [], step: 0 });
});

test('the seven-day line leaves out the time before the first trade', () => {
  const up = sparkSvg([0, 0, 1, 2, 3]);
  assert.match(up, /stroke="#3ddc84"/);
  assert.equal((up.match(/,/g) || []).length, 3);
  assert.match(sparkSvg([3, 2]), /stroke="#f0a35e"/);
  assert.doesNotMatch(sparkSvg([0, 0]), /polyline/);
});

test('the attribution notice links to TradingView', () => {
  assert.equal(CHART_NOTICE.href, 'https://www.tradingview.com/');
});

test('an interval with no trade holds the last price, so empty days keep their place', () => {
  const H = 3600;
  const cs = [{ t: 0, o: 1, h: 1, l: 1, c: 1, v: 5 }, { t: 3 * H, o: 2, h: 3, l: 2, c: 2.5, v: 1 }];
  const f = fillCandles(cs, H, 0, 5 * H + 10);
  assert.deepEqual(f.map((c) => [c.t, c.c, c.v]), [[0, 1, 5], [H, 1, 0], [2 * H, 1, 0], [3 * H, 2.5, 1], [4 * H, 2.5, 0], [5 * H, 2.5, 0]]);
  assert.deepEqual([f[1].o, f[1].h, f[1].l], [1, 1, 1]);
  // A range starting after the first trade carries the close before it in.
  assert.deepEqual(fillCandles(cs, H, 4 * H, 5 * H).map((c) => [c.t, c.c]), [[4 * H, 2.5], [5 * H, 2.5]]);
  // Nothing before the market's first trade.
  assert.equal(fillCandles(cs, H, -10 * H, H)[0].t, 0);
  assert.deepEqual(fillCandles([], H, 0, H), []);
  assert.equal(fillCandles(cs, 60, 0, 1e9, 100).length, 100);
});
