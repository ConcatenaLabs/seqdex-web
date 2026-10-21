// The leaves room's reading of the relay: which on-chain orders a taker paying from
// leaves is offered, and where a fill paid from leaves stands.
// Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillableState, takeView, latestRecords, rateOf, servesPair } from '../shared/leaf-room.js';

const T0 = 'aa'.repeat(32), R = 'bb'.repeat(32);
const offer = (txid = T0, vout = 0) => ({ offer_id: 'o1', offer_amount: '600000', covenant: { covenant_txid: txid, covenant_vout: vout } });
const rec = (over) => ({ offer_id: 'o1', txid: R, input: 0, spent: T0 + ':0', filled: '600000', remainder: '0', state: 'confirmed',
  anchor_depth: 0, required_depth: 2, certified: true, height: 120, recorded: '2026-10-20T20:00:00Z', ...over });

test('an order no fill holds is offered, at what it holds', () => {
  assert.deepEqual(fillableState(offer(), []), { fillable: true, why: null, holds: '600000' });
});

test('an order filled whole and not final is not offered, though the relay still lists it', () => {
  const s = fillableState(offer(), [rec({})]);
  assert.equal(s.fillable, false);
  assert.match(s.why, /filled whole by .* not final \(anchor 0 of 2/);
  const f = fillableState(offer(), [rec({ state: 'final', anchor_depth: 2 })]);
  assert.equal(f.fillable, false);
});

test('an undone fill gives the order back', () => {
  assert.equal(fillableState(offer(), [rec({ state: 'undone' })]).fillable, true);
  // Undone, then mined again: the newer record holds it.
  assert.equal(fillableState(offer(), [rec({ state: 'undone' }), rec({ recorded: '2026-10-20T20:05:00Z' })]).fillable, false);
});

test('the rest of a fill that is not final is not offered; once the fill is final it is, at the remainder', () => {
  const part = { remainder: '100500', filled: '499500', rest: { vout: 3, value: 100500 } };
  const s = fillableState(offer(R, 3), [rec(part)]);
  assert.equal(s.fillable, false);
  assert.match(s.why, /rests again after a fill .* not final/);
  assert.equal(s.holds, '100500');
  assert.deepEqual(fillableState(offer(R, 3), [rec({ ...part, state: 'final' })]), { fillable: true, why: null, holds: '100500' });
});

test('a take reads submitted, round built, forfeits in, in a round, final, undone, then final again', () => {
  const take = (stage, round = null, leaf = null) => ({ take: 't', stage, round, order: T0 + ':0', leaf });
  assert.equal(takeView(take('submitted'), []).key, 'submitted');
  assert.equal(takeView(take('handing-over', R), []).key, 'handing-over');
  assert.equal(takeView(take('forfeits-in', R), []).key, 'forfeits-in');
  assert.equal(takeView(take('forfeits-in', R), [rec({})]).key, 'in-round');
  assert.equal(takeView(take('released', R, { state: 'live' }), [rec({ state: 'final' })]).key, 'final');
  const undone = [rec({ state: 'final' }), rec({ state: 'undone', reason: 'its block left the active chain', recorded: '2026-10-20T20:01:00Z' })];
  const u = takeView(take('released', R), undone);
  assert.equal(u.key, 'undone');
  assert.match(u.detail, /its block left the active chain/);
  const again = [...undone, rec({ recorded: '2026-10-20T20:02:00Z' })];
  assert.equal(takeView(take('released', R), again).key, 'in-round');
  assert.equal(takeView(take('released', R), [...again, rec({ state: 'final', recorded: '2026-10-20T20:03:00Z' })]).key, 'final');
  assert.equal(takeView(take('void'), []).key, 'void');
  // A record of another order in the same round is not this take's.
  assert.equal(takeView(take('forfeits-in', R), [rec({ spent: 'cc'.repeat(32) + ':1' })]).key, 'forfeits-in');
});

test('latest records keep one per fill', () => {
  assert.equal(latestRecords([rec({}), rec({ recorded: '2026-10-20T20:00:01.5Z', state: 'final' })])[0].state, 'final');
});

test('a rate is the two amounts reduced', () => {
  assert.deepEqual(rateOf('600000', '1200000'), { num: '2', den: '1' });
  assert.deepEqual(rateOf('400000', '1000000'), { num: '5', den: '2' });
  assert.throws(() => rateOf('0', '5'));
});

test('a pair is served when the operator serves both assets', () => {
  const op = { assets: [{ asset: 'x' }, { asset: 'y' }] };
  assert.equal(servesPair(op, 'x', 'y'), true);
  assert.equal(servesPair(op, 'x', 'z'), false);
  assert.equal(servesPair({ assets: ['x', 'y'] }, 'y', 'x'), true);
});
