// The leaf room's reading of the relay and the wallet: pure functions, no I/O.
//
// The relay serves two things this room joins: the on-chain book (covenant orders,
// each at the outpoint it rests at now) and the pair's fill records
// (`/v1/market/{base}/{quote}/fills`), each read from the filling transaction's
// outputs and kept as the chain stands: `confirmed` (in a block), `final` (the block
// certified and its Bitcoin anchor buried), `undone` (its block left the chain).
//
// The relay keeps serving an order filled whole until that fill is final (it is held
// from its own matching, not removed), and serves the rest of an order filled in part
// at its new outpoint as soon as the fill is in a block. Neither may be offered to a
// taker paying from leaves: the operator's round takes only an order whose
// transaction is final, and a full fill that is not final can still be undone by a
// Bitcoin reorganisation, which is why the order is still listed. So the room offers
// an order only when no fill record holds it, and says why when one does.

const outpoint = (txid, vout) => `${txid}:${Number(vout)}`;

export function covenantOutpoint(offer) {
  const c = offer && (offer.covenant || offer.Covenant);
  if (!c) return null;
  const txid = c.covenant_txid || c.covenantTxid;
  if (!txid) return null;
  return outpoint(txid, c.covenant_vout ?? c.covenantVout ?? 0);
}

// The newest record of each fill (same transaction, same order outpoint spent): a fill
// undone and then mined again is recorded twice, and the newer record is where it
// stands now.
export function latestRecords(fills) {
  const by = new Map();
  for (const f of fills || []) {
    const k = `${f.txid}/${f.spent}`;
    const have = by.get(k);
    if (!have || (Date.parse(f.recorded || 0) || 0) >= (Date.parse(have.recorded || 0) || 0)) by.set(k, f);
  }
  return [...by.values()];
}

function depth(f) {
  return f && f.required_depth != null ? `anchor ${f.anchor_depth ?? 0} of ${f.required_depth} Bitcoin blocks deep${f.certified ? ', block certified' : ''}` : '';
}

// Whether a covenant order of the book may be filled from leaves now, from the pair's
// fill records. Answers { fillable, why, holds }:
//   fillable  true only when no fill in a block holds the order at its outpoint
//   why       a sentence for an order that is not
//   holds     what the order holds now, as far as the records show (its remainder
//             after its last fill in a block), else the offer's amount
export function fillableState(offer, fills) {
  const at = covenantOutpoint(offer);
  if (!at) return { fillable: false, why: 'not an on-chain order', holds: null };
  const recs = latestRecords(fills).filter((f) => f.offer_id === offer.offer_id && f.state !== 'undone');
  // A fill in a block that spent the order where it is listed: the order is filled
  // whole (or its rest moved), and the fill is not final yet.
  const spentHere = recs.find((f) => f.spent === at);
  if (spentHere) {
    if (spentHere.state === 'final') return { fillable: false, why: 'filled; the relay delists it now', holds: '0' };
    return {
      fillable: false, holds: String(spentHere.locked ?? spentHere.remainder ?? 0),
      why: `filled ${spentHere.remainder && BigInt(spentHere.remainder) > 0n ? 'in part' : 'whole'} by ${spentHere.txid.slice(0, 12)}…, in a block and not final (${depth(spentHere)}): not offered until the fill is final, since a Bitcoin reorganisation can still undo it`,
    };
  }
  // Resting again at the rest of a fill that is in a block but not final.
  const restHere = recs.find((f) => f.rest && outpoint(f.txid, f.rest.vout) === at);
  if (restHere && restHere.state !== 'final') {
    return {
      fillable: false, holds: String(restHere.remainder),
      why: `rests again after a fill by ${restHere.txid.slice(0, 12)}…, which is not final (${depth(restHere)}): the operator's round takes the rest once that fill is final`,
    };
  }
  return { fillable: true, why: null, holds: restHere ? String(restHere.remainder) : String(offer.offer_amount ?? offer.base_amount ?? '') };
}

// Where a take stands, from the wallet's answer (getLeafTakes / leafTake) and the
// relay's fill records. Answers { key, label, detail }, `key` one of:
//   submitted, handing-over, forfeits-in, in-round, final, undone, void
export function takeView(take, fills) {
  if (!take) return { key: 'unknown', label: 'unknown', detail: '' };
  if (take.stage === 'void') {
    return { key: 'void', label: 'voided', detail: 'the take did not happen: the coins it gave up are yours again' };
  }
  const recs = take.round ? latestRecords(fills).filter((f) => f.txid === take.round && f.spent === take.order) : [];
  const rec = recs[0] || null;
  if (rec && rec.state === 'undone') {
    return { key: 'undone', label: 'undone', detail: `the round's block left the chain${rec.reason ? ': ' + rec.reason : ''}. The fill counts again once the round is mined again and final` };
  }
  if (rec && rec.state === 'final') {
    const leaf = take.leaf && take.leaf.state ? `; your leaf is ${take.leaf.state}` : '';
    return { key: 'final', label: 'final', detail: `the round's block is certified and its Bitcoin anchor buried (${depth(rec)})${leaf}` };
  }
  if (rec && rec.state === 'confirmed') {
    return { key: 'in-round', label: 'in a round', detail: `the round ${take.round.slice(0, 12)}… is in block ${rec.height}; final once ${depth(rec).replace(/^anchor/, 'its anchor is')}` };
  }
  switch (take.stage) {
    case 'submitted': return { key: 'submitted', label: 'submitted', detail: 'the operator holds the take; it waits for the round that fills the order' };
    case 'handing-over': return { key: 'handing-over', label: 'round built', detail: 'the operator built the round; your wallet is handing over its forfeits' };
    case 'forfeits-in': return { key: 'forfeits-in', label: 'forfeits handed over', detail: take.round ? `the round ${take.round.slice(0, 12)}… goes out once every take in it has handed its forfeits over` : 'the round goes out once every take in it has' };
    case 'released': return { key: 'in-round', label: 'in a round', detail: 'your wallet holds the leaf; the relay has not recorded the round yet' };
    default: return { key: 'unknown', label: String(take.stage || take.state || 'unknown'), detail: '' };
  }
}

function gcd(a, b) { while (b) [a, b] = [b, a % b]; return a; }

// The order's rate from "sell this many atoms for that many atoms in all": the two
// reduced, as the covenant takes them (rate_num atoms wanted per rate_den sold).
export function rateOf(sellAtoms, wantAtoms) {
  const s = BigInt(sellAtoms), w = BigInt(wantAtoms);
  if (s <= 0n || w <= 0n) throw new Error('both amounts must be positive');
  const g = gcd(s, w);
  return { num: (w / g).toString(), den: (s / g).toString() };
}

// Whether the operator serves both assets of a pair: a take pays a leaf of the one and
// gives up leaves of the other.
export function servesPair(operator, base, quote) {
  const list = (operator && operator.assets) || [];
  const ids = new Set(list.map((a) => (typeof a === 'string' ? a : a.asset)).filter(Boolean));
  return ids.has(base) && ids.has(quote);
}

// ---- orders resting in the operator's tree ----
//
// An order resting as a leaf in an operator's tree (`resting_leaf`) is listed by the
// relay at its locator: the coin it rests at now and what that coin holds, which the
// relay moves at every fill from the operator's own view. Its fills are the relay's
// records keyed by the operator's transfer id (`taker.via` "operator_tree"), final when the
// round the order rests on is.

// One resting order of the book as the room shows it, or null for any other offer:
// its operator (key, URL), its id (the leaf id of its first coin), its locator, what
// it can be filled for now (the relay's live size), its terms, and its fill records,
// newest last. `fillable` says whether this wallet can fill it from its leaves: only
// an order resting with the operator the wallet joined.
export function restingRow(offer, fills, operatorKey) {
  const t = offer && (offer.resting_leaf || offer.restingLeaf);
  if (!t) return null;
  const mine = (latestRecords(fills) || []).filter((f) => f.offer_id === offer.offer_id && f.taker && f.taker.via === 'operator_tree');
  mine.sort((a, b) => (Date.parse(a.recorded || 0) || 0) - (Date.parse(b.recorded || 0) || 0));
  const holds = String(offer._active ?? t.value ?? '0');
  const sameOperator = !!operatorKey && String(t.operator_key || '').toLowerCase() === String(operatorKey).toLowerCase();
  let why = null;
  if (!sameOperator) why = 'rests with another operator than the one your wallet joined';
  else if (BigInt(holds) <= 0n) why = 'its operator cannot be asked right now, so the relay lists it at nothing';
  return {
    offer, order: t.order_id, operator: t.operator_key, operatorUrl: t.operator_url,
    coin: t.coin, value: String(t.value ?? '0'), holds,
    rate: { num: String(t.rate_num), den: String(t.rate_den) }, minLot: String(t.min_lot),
    fills: mine, fillable: sameOperator && BigInt(holds) > 0n, why,
  };
}

// A fill record of a resting order, in the room's words.
export function restingFillView(f) {
  if (!f) return { key: 'unknown', label: 'unknown', detail: '' };
  const round = f.taker && f.taker.round_txid ? f.taker.round_txid.slice(0, 12) + '…' : 'its round';
  if (f.state === 'undone') return { key: 'undone', label: 'undone', detail: `the round its order rests on left the chain${f.reason ? ': ' + f.reason : ''}; the fill counts again once that round is mined again and final` };
  if (f.state === 'final') return { key: 'final', label: 'final', detail: `the round ${round} its order rests on is final (${depth(f)})` };
  return { key: 'confirmed', label: 'in the tree', detail: `co-signed by the operator; final once the round ${round} its order rests on is (${depth(f)})` };
}
