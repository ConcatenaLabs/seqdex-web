import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sma, ema, bollinger, vwap, rsi, INDICATORS } from '../shared/indicators.js';

const C = (closes, t0 = 0, step = 3600) => closes.map((c, i) => ({ t: t0 + i * step, o: c, h: c, l: c, c, v: 1 }));
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('sma averages the last n closes, from the n-th candle', () => {
  const s = sma(C([1, 2, 3, 4, 5]), 3);
  assert.deepEqual(s.map((p) => p.value), [2, 3, 4]);
  assert.equal(s[0].time, 2 * 3600);
  assert.deepEqual(sma(C([1, 2]), 3), []);
});

test('ema seeds with the simple average and weights 2/(n+1)', () => {
  const e = ema(C([1, 2, 3, 4]), 3);
  near(e[0].value, 2);            // average of 1, 2, 3
  near(e[1].value, 4 * 0.5 + 2 * 0.5);
  assert.equal(e.length, 2);
});

test('bollinger bands sit k population deviations from the average', () => {
  const b = bollinger(C([2, 4, 4, 4, 5, 5, 7, 9]), 8, 2);
  near(b.middle[0].value, 5);
  near(b.upper[0].value, 9);      // deviation of this textbook series is 2
  near(b.lower[0].value, 1);
});

test('vwap weights typical prices by volume and starts again each UTC day', () => {
  const day = 86400;
  const cs = [
    { t: day - 7200, o: 0, h: 12, l: 6, c: 9, v: 1 },   // typical 9
    { t: day - 3600, o: 0, h: 3, l: 3, c: 3, v: 2 },    // typical 3
    { t: day, o: 0, h: 10, l: 10, c: 10, v: 5 },        // a new day
    { t: day + 3600, o: 0, h: 1, l: 1, c: 1, v: 0 },    // no volume: unchanged
  ];
  assert.deepEqual(vwap(cs).map((p) => p.value), [9, 5, 10, 10]);
});

test('rsi: only rises read 100, no movement 50, and Wilder smoothing in between', () => {
  assert.equal(rsi(C([1, 2, 3, 4, 5]), 3)[0].value, 100);
  assert.equal(rsi(C([5, 5, 5, 5]), 3)[0].value, 50);
  // Gains 1, 1, losses 1 over three steps: avg gain 2/3, loss 1/3, RS 2.
  const r = rsi(C([10, 11, 12, 11, 11]), 3);
  near(r[0].value, 100 - 100 / 3);
  // Next step flat: gain 4/9, loss 2/9, RS still 2.
  near(r[1].value, 100 - 100 / 3);
});

test('every indicator draws from the same candles and has its words', () => {
  const cs = C(Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i) * 5));
  for (const ind of INDICATORS) {
    assert.ok(ind.label && ind.color && ind.key);
    if (ind.lines) for (const pts of ind.lines(cs)) assert.ok(pts.length > 0, ind.key);
  }
  assert.deepEqual(INDICATORS.filter((i) => i.on).map((i) => i.key), ['vol', 'ma7', 'ma25']);
});
