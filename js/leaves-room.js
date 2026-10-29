// The leaf room (developer mode): the on-chain covenant orders a taker paying from
// leaves can fill through the operator the wallet joined, a fill paid from leaves
// through the extension (`takeOrder`) with where it stands, and placing an order on
// the chain from leaves (`placeOrderFromLeaves`); and the orders resting as leaves in
// operators' trees, each with its operator, its order id and its locator (the coin
// it rests at and what that coin holds), filled from leaves (`fillRestingOrder`),
// rested (`restOrder`) and cancelled (`cancelRestingOrder`).
//
// The room exists only while the wallet says it is in developer mode
// (`getWalletMode`, then `modeChanged`); in user mode nothing of it is drawn. The
// site holds nothing: the takes and orders, their records and every key are the
// extension's, and the room reads them back (`getLeafTakes`, `getLeafOrders`). Book
// and fill records are the on-chain relay's, joined in shared/leaf-room.js.
import { initChrome, footer, $, el } from '../shared/app.js';
import { assetMeta, fmtAtoms, usdFor } from '../shared/meta.js';
import { MOUNTS, markets, orderbook, unexpired } from '../shared/book.js';
import { fillableState, takeView, rateOf, servesPair, covenantOutpoint, restingRow, restingFillView } from '../shared/leaf-room.js';
import * as P from '../shared/provider.js';

const POLL_BUSY_MS = 4000;
const POLL_IDLE_MS = 15000;

await initChrome('leaves.html');
footer();

const room = $('room');
const S = { mode: null, operator: null, opErr: null, rows: [], fills: new Map(), takes: [], orders: [], balances: null, timer: null, busy: null, again: false,
  resting: [], myResting: [] };

const tk = (h) => assetMeta(h).ticker;

// A status line under a panel that is drawn again on every poll: what it says is kept
// here, so an answer that arrives after a redraw is not lost with the old element.
const STATUS = {};
function statusLine(id) {
  const st = el('div', 'status' + (STATUS[id] && STATUS[id].cls ? ' ' + STATUS[id].cls : ''), STATUS[id] ? STATUS[id].text : '');
  st.id = id; st.setAttribute('role', 'status');
  return st;
}
function say(id, cls, text) {
  STATUS[id] = { cls, text };
  const st = $(id);
  if (st) { st.className = 'status' + (cls ? ' ' + cls : ''); st.textContent = text; }
}
const amt = (atoms, h) => {
  const m = assetMeta(h);
  const usd = usdFor(h, atoms);
  return `${fmtAtoms(atoms, m.precision ?? 8)} ${m.ticker} (${atoms} atoms${usd != null ? ', ≈ $' + usd.toFixed(2) : ''})`;
};
const short = (s, n = 12) => (s ? String(s).slice(0, n) + '…' : '');

async function readMode() {
  try { return (await P.request('getWalletMode')).mode; } catch { return null; }
}

// ---- drawing ----
function clear() { room.textContent = ''; }

function drawAbsent() {
  clear();
  document.title = 'SeqDEX';
  room.appendChild(el('p', 'sub', P.hasWallet()
    ? 'Nothing here in the wallet’s current mode.'
    : 'Nothing here without a wallet.'));
}

function panel(title, id) {
  const p = el('section', 'panel room-panel');
  const h = el('h2'); h.appendChild(document.createTextNode(title)); p.appendChild(h);
  if (id) p.id = id;
  return p;
}

function drawRoom() {
  clear();
  document.title = 'Leaves · SeqDEX';
  const rules = el('div', 'rules');
  rules.appendChild(el('b', null, 'The leaves room fills on-chain orders from your leaves, and places orders on the chain from them. '));
  rules.appendChild(document.createTextNode('Your operator’s round spends the order, pays its maker on the chain and pays you a leaf. '
    + 'A fill is final once its block is certified and its Bitcoin anchor buried; until then a Bitcoin reorganisation can undo it, and this room shows it undone. '
    + 'An order placed from leaves is an ordinary on-chain order: it rests with you offline until filled, and only its refund takes it back. '
    + 'An order resting in the tree is a leaf the operator holds: takers fill it there, one transfer each that the operator co-signs, with its maker away; each fill rests what is left at a new coin, and its maker can cancel it with the operator. Values are in atoms.'));
  room.appendChild(rules);
  const grid = el('div', 'room-grid');
  const left = el('div'), right = el('div');
  grid.appendChild(left); grid.appendChild(right);
  room.appendChild(grid);

  left.appendChild(panel('Orders you can fill from leaves', 'pOrders'));
  left.appendChild(panel('Your fills', 'pTakes'));
  left.appendChild(panel('Your orders placed from leaves', 'pMine'));
  left.appendChild(panel('Orders resting in the tree', 'pResting'));
  left.appendChild(panel('Your orders resting in the tree', 'pMyResting'));
  right.appendChild(panel('Operator', 'pOperator'));
  right.appendChild(panel('Your leaves', 'pLeaves'));
  right.appendChild(panel('Place an order from leaves', 'pPlace'));
  right.appendChild(panel('Rest an order in the tree', 'pRest'));
  drawOperator(); drawOrders(); drawTakes(); drawMine(); drawResting(); drawMyResting(); drawLeaves(); drawPlace(); drawRest();
}

function need(box) {
  if (P.account()) return false;
  box.appendChild(el('p', 'sub', 'Connect the wallet to use this room.'));
  return true;
}

function body(id) {
  const p = $(id);
  if (!p) return null;
  while (p.childNodes.length > 1) p.removeChild(p.lastChild);
  return p;
}

function drawOperator() {
  const p = body('pOperator'); if (!p || need(p)) return;
  if (S.opErr) { p.appendChild(el('p', 'status err', S.opErr)); return; }
  const op = S.operator;
  if (!op) { p.appendChild(el('p', 'sub', 'Reading the operator your wallet joined…')); return; }
  const row = (k, v, mono) => { const r = el('div', 'wrow'); r.appendChild(el('span', 'sub', k)); r.appendChild(el('span', mono ? 'amt mono' : 'amt', v)); p.appendChild(r); };
  row('Key', op.operator || '?', true);
  if (op.server) row('Server', op.server, true);
  if (op.forfeit_window_seconds != null) row('Forfeit window', Math.round(op.forfeit_window_seconds / 60) + ' min after it builds a round');
  for (const a of op.assets || []) {
    const id = typeof a === 'string' ? a : a.asset;
    const fee = typeof a === 'object' && a.fees ? a.fees : (typeof a === 'object' ? a : {});
    const off = fee.offboard_base != null || fee.offboard_ppm != null
      ? `fills: ${fee.offboard_ppm ?? 0} ppm + ${fee.offboard_base ?? 0} atoms of the asset paid` : '';
    row(tk(id), off || short(id, 16));
  }
}

function drawLeaves() {
  const p = body('pLeaves'); if (!p || need(p)) return;
  const b = S.balances;
  if (!b) { p.appendChild(el('p', 'sub', 'Reading your leaves…')); return; }
  const ids = Object.keys(b.leaves || {});
  if (!ids.length) { p.appendChild(el('p', 'sub', 'No leaves yet. Board some from the wallet’s leaf address, or receive them.')); return; }
  for (const id of ids) {
    const r = el('div', 'wrow');
    r.appendChild(el('span', 'tk', tk(id)));
    const states = Object.entries(b.leaves[id].states || {}).filter(([, v]) => v !== '0').map(([s, v]) => `${v} ${s}`).join(' · ');
    r.appendChild(el('span', 'sub2', states));
    r.appendChild(el('span', 'amt', b.leaves[id].total));
    p.appendChild(r);
  }
}

function drawOrders() {
  const p = body('pOrders'); if (!p) return;
  if (!S.rows.length) {
    p.appendChild(el('p', 'sub', P.account() && S.operator
      ? 'No on-chain order in a pair your operator serves right now.'
      : 'On-chain orders in the pairs your operator serves appear here once the wallet is connected.'));
    return;
  }
  const t = el('table', 'book leaf-book');
  const hr = el('tr');
  for (const h of ['Sells', 'For', 'Smallest fill', 'Order', 'Fill from leaves']) hr.appendChild(el('th', null, h));
  const th = el('thead'); th.appendChild(hr); t.appendChild(th);
  const tb = el('tbody');
  for (const r of S.rows) {
    const o = r.offer, c = o.covenant;
    const tr = el('tr');
    tr.dataset.offer = o.offer_id;
    tr.appendChild(el('td', 'mono', amt(r.state.holds || o.offer_amount, o.pair.base_asset)));
    tr.appendChild(el('td', 'mono', `${c.rate_num} ${tk(o.pair.quote_asset)} atoms per ${c.rate_den} ${tk(o.pair.base_asset)} atoms`));
    tr.appendChild(el('td', 'mono', String(c.min_lot)));
    const at = el('td', 'mono faint', short(covenantOutpoint(o), 14));
    at.title = covenantOutpoint(o) + ' · offer ' + o.offer_id;
    tr.appendChild(at);
    const act = el('td');
    if (r.state.fillable) {
      const inp = el('input', 'mono take-amt');
      inp.placeholder = 'all (' + (r.state.holds || o.offer_amount) + ')';
      inp.setAttribute('aria-label', 'Atoms of ' + tk(o.pair.base_asset) + ' to fill');
      const b = el('button', 'btn small', 'Fill');
      b.type = 'button';
      b.onclick = () => take(r, inp.value.trim(), b);
      act.appendChild(inp); act.appendChild(b);
    } else {
      act.appendChild(el('span', 'pill muted', 'not offered'));
    }
    tr.appendChild(act);
    tb.appendChild(tr);
    // Why an order is not offered, on a line of its own under it.
    if (!r.state.fillable) {
      const why = el('tr', 'why');
      why.dataset.offer = o.offer_id;
      const td = el('td', 'sub not-fillable', r.state.why);
      td.colSpan = 5;
      why.appendChild(td);
      tb.appendChild(why);
    }
  }
  t.appendChild(tb);
  p.appendChild(t);
  p.appendChild(statusLine('takeStatus'));
}

function drawTakes() {
  const p = body('pTakes'); if (!p || need(p)) return;
  if (!S.takes.length) { p.appendChild(el('p', 'sub', 'Fills you pay from leaves appear here, from submitted to final.')); return; }
  for (const t of [...S.takes].reverse()) {
    const v = takeView(t, S.fills.get(pairKey(t.pair)) || []);
    const box = el('div', 'take take-' + v.key);
    box.dataset.take = t.take;
    box.dataset.state = v.key;
    const head = el('div', 'wrow');
    head.appendChild(el('span', 'pill', v.label));
    head.appendChild(el('span', 'mono', `${t.filled} ${tk(t.asset_a)} for ${t.price} ${tk(t.asset_b)} + fee ${t.fee}`));
    head.appendChild(el('span', 'amt faint mono', short(t.take, 10)));
    box.appendChild(head);
    box.appendChild(el('p', 'sub', v.detail));
    const meta = el('p', 'sub2 mono faint', `order ${t.order}${t.round ? ' · round ' + t.round : ''}${t.leaf && t.leaf.leaf_id ? ' · leaf ' + short(t.leaf.leaf_id, 16) : ''}`);
    box.appendChild(meta);
    p.appendChild(box);
  }
}

function drawMine() {
  const p = body('pMine'); if (!p || need(p)) return;
  if (!S.orders.length) { p.appendChild(el('p', 'sub', 'Orders you place from leaves appear here: placed, resting, listed, filled.')); return; }
  const words = { waiting: 'waiting for its round', in_round: 'in its round', not_placed: 'not placed', unlocking: 'being unlocked into its address', resting: 'resting on the chain', filled: 'filled', refunded: 'refunded', spent: 'spent' };
  for (const o of [...S.orders].reverse()) {
    const box = el('div', 'take');
    box.dataset.order = o.order;
    box.dataset.state = o.state || '';
    const head = el('div', 'wrow');
    head.appendChild(el('span', 'pill', words[o.state] || o.state || '…'));
    const a = o.terms ? o.terms.asset_a : null;
    head.appendChild(el('span', 'mono', o.holds ? `holds ${o.holds} atoms` : ''));
    head.appendChild(el('span', 'amt faint mono', short(o.order, 10)));
    box.appendChild(head);
    const lines = [];
    if (o.rests_at) lines.push('at ' + o.rests_at);
    const listedUntil = o.posted ? new Date(o.posted.relay_expires * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : null;
    if (o.state === 'resting') lines.push(o.posted ? `listed on the relay as ${o.offer_id} (until ${listedUntil})` : 'listing on the relay…');
    else if (['waiting', 'in_round', 'unlocking'].includes(o.state)) lines.push('listed on the relay once it rests');
    else if (o.posted) lines.push(`was listed on the relay as ${o.offer_id}`);
    if (o.fills && o.fills.length) lines.push(o.fills.length + ' fill(s) on the chain, ' + (o.credits || []).length + ' credit(s) paid to you');
    if (o.post_error && o.state === 'resting') lines.push('not listed yet: ' + o.post_error);
    if (o.note) lines.push(o.note);
    box.appendChild(el('p', 'sub', lines.join(' · ')));
    void a;
    p.appendChild(box);
  }
}

function drawPlace() {
  const p = body('pPlace'); if (!p || need(p)) return;
  const served = (S.operator && S.operator.assets || []).map((a) => (typeof a === 'string' ? a : a.asset)).filter(Boolean);
  const sel = (id) => { const s = el('select', 'mono'); s.id = id; for (const a of served) { const o = el('option', null, tk(a)); o.value = a; s.appendChild(o); } return s; };
  const field = (label, input) => { const l = el('label', 'field'); l.appendChild(el('span', 'sub', label)); l.appendChild(input); p.appendChild(l); return input; };
  const txt = (id, ph) => { const i = el('input', 'mono'); i.id = id; i.placeholder = ph || ''; i.autocomplete = 'off'; return i; };
  const sell = field('Sell', sel('plSell'));
  const amount = field('Atoms to sell', txt('plAmount'));
  const want = field('For', sel('plWant'));
  if (served.length > 1) want.value = served[1];
  const total = field('Atoms wanted for all of it', txt('plTotal'));
  const lot = field('Smallest fill, atoms', txt('plLot', 'the order’s whole amount'));
  const hours = field('Refundable after, hours', txt('plHours', '24'));
  const b = el('button', 'btn', 'Place from leaves');
  b.type = 'button'; b.id = 'btnPlace';
  p.appendChild(b);
  p.appendChild(statusLine('placeStatus'));
  p.appendChild(el('p', 'sub2 faint', 'The fee is paid in the asset sold, from the coins given up, as your operator’s schedule asks; the wallet shows it before anything is signed.'));
  b.onclick = async () => {
    say('placeStatus', '', '');
    try {
      if (sell.value === want.value) throw new Error('an order sells one asset for another');
      const r = rateOf(amount.value.trim(), total.value.trim());
      const params = { sell: sell.value, want: want.value, amount: amount.value.trim(), rate_num: r.num, rate_den: r.den };
      if (lot.value.trim()) params.min_lot = lot.value.trim();
      const h = Number(hours.value.trim() || '0');
      if (h > 0) params.expiry = String(Math.floor(Date.now() / 1000) + Math.round(h * 3600));
      b.disabled = true;
      say('placeStatus', '', 'Waiting for your approval in the wallet…');
      const out = await P.request('placeOrderFromLeaves', params);
      say('placeStatus', 'ok', `Placed: order ${short(out.order, 16)} (${out.state}). It rests once its round is final; the wallet lists it then.`);
      await refresh();
    } catch (e) {
      say('placeStatus', 'err', e.message);
    } finally { b.disabled = false; }
  };
}

// The orders resting in the tree, each with its operator, its order id and where it
// rests now (the locator the relay moves at every fill), and its fills.
function drawResting() {
  const p = body('pResting'); if (!p) return;
  if (!S.resting.length) {
    p.appendChild(el('p', 'sub', 'No order rests in an operator’s tree in the relay’s book right now.'));
    p.appendChild(statusLine('restFillStatus'));
    return;
  }
  for (const r of S.resting) {
    const o = r.offer;
    const box = el('div', 'take resting');
    box.dataset.order = r.order;
    box.dataset.offer = o.offer_id;
    const head = el('div', 'wrow');
    head.appendChild(el('span', 'pill', r.fillable ? 'resting' : 'not offered'));
    head.appendChild(el('span', 'mono', `sells ${amt(r.holds, o.offer_asset)} for ${r.rate.num} ${tk(o.want_asset)} atoms per ${r.rate.den}`));
    box.appendChild(head);
    const kv = (k, v) => { const l = el('p', 'sub2 mono'); l.appendChild(el('span', 'faint', k + ' ')); l.appendChild(document.createTextNode(v)); box.appendChild(l); };
    kv('operator', r.operator + (r.operatorUrl ? ' at ' + r.operatorUrl : ''));
    kv('order', r.order);
    kv('rests at', r.coin + ', holding ' + r.value + ' atoms');
    kv('smallest fill', r.minLot + ' atoms');
    for (const f of r.fills) {
      const v = restingFillView(f);
      const line = el('p', 'sub fill-' + v.key);
      line.dataset.transfer = f.txid;
      line.dataset.state = v.key;
      line.textContent = `${v.label}: ${f.filled} filled from coin ${short(f.spent, 12)}, ${f.credit ? f.credit.value : '?'} to the maker (transfer ${short(f.txid, 12)}); ${v.detail}`;
      box.appendChild(line);
    }
    if (r.fillable && P.account()) {
      const row = el('div', 'wrow');
      const inp = el('input', 'mono take-amt');
      inp.placeholder = 'all (' + r.holds + ')';
      inp.setAttribute('aria-label', 'Atoms of ' + tk(o.offer_asset) + ' to fill');
      const b = el('button', 'btn small', 'Fill from leaves');
      b.type = 'button';
      b.onclick = () => fillResting(r, inp.value.trim(), b);
      row.appendChild(inp); row.appendChild(b);
      box.appendChild(row);
    } else if (r.why) {
      box.appendChild(el('p', 'sub not-fillable', r.why));
    }
    p.appendChild(box);
  }
  p.appendChild(statusLine('restFillStatus'));
}

function drawMyResting() {
  const p = body('pMyResting'); if (!p || need(p)) return;
  if (!S.myResting.length) { p.appendChild(el('p', 'sub', 'Orders you rest in the tree appear here: resting, filled, cancelled, with the credits paid to you.')); p.appendChild(statusLine('restCancelStatus')); return; }
  for (const o of [...S.myResting].reverse()) {
    const box = el('div', 'take');
    box.dataset.order = o.order || o.rested_by;
    box.dataset.state = o.state || '';
    const head = el('div', 'wrow');
    head.appendChild(el('span', 'pill', o.state === 'participating' ? 'waiting for its round' : (o.state || '…')));
    head.appendChild(el('span', 'mono', o.holds != null ? `holds ${o.holds} of ${o.amount} atoms` : `${o.amount} atoms`));
    head.appendChild(el('span', 'amt faint mono', short(o.order || o.rested_by, 10)));
    box.appendChild(head);
    const lines = [];
    if (o.coin) lines.push('rests at ' + o.coin);
    if (o.listed) lines.push('listed on the relay as ' + o.offer_id);
    else if (o.state === 'resting') lines.push(o.post_error ? 'not listed yet: ' + o.post_error : 'listing on the relay…');
    if (o.fills && o.fills.length) lines.push(o.fills.length + ' fill(s) in the tree');
    if (o.credits && o.credits.length) lines.push(o.credits.length + ' credit(s) held: ' + o.credits.map((c) => c.value).join(', ') + ' atoms');
    box.appendChild(el('p', 'sub', lines.join(' · ')));
    if (o.state === 'resting' && o.order) {
      const b = el('button', 'btn small', 'Cancel');
      b.type = 'button';
      b.onclick = () => cancelResting(o, b);
      box.appendChild(b);
    }
    p.appendChild(box);
  }
  p.appendChild(statusLine('restCancelStatus'));
}

function drawRest() {
  const p = body('pRest'); if (!p || need(p)) return;
  const served = (S.operator && S.operator.assets || []).map((a) => (typeof a === 'string' ? a : a.asset)).filter(Boolean);
  const sel = (id) => { const s = el('select', 'mono'); s.id = id; for (const a of served) { const o = el('option', null, tk(a)); o.value = a; s.appendChild(o); } return s; };
  const field = (label, input) => { const l = el('label', 'field'); l.appendChild(el('span', 'sub', label)); l.appendChild(input); p.appendChild(l); return input; };
  const txt = (id, ph) => { const i = el('input', 'mono'); i.id = id; i.placeholder = ph || ''; i.autocomplete = 'off'; return i; };
  const sell = field('Sell', sel('rsSell'));
  const amount = field('Atoms to sell', txt('rsAmount'));
  const want = field('For', sel('rsWant'));
  if (served.length > 1) want.value = served[1];
  const total = field('Atoms wanted for all of it', txt('rsTotal'));
  const lot = field('Smallest fill, atoms', txt('rsLot', 'the order’s whole amount'));
  const b = el('button', 'btn', 'Rest in the tree');
  b.type = 'button'; b.id = 'btnRest';
  p.appendChild(b);
  p.appendChild(statusLine('restStatus'));
  p.appendChild(el('p', 'sub2 faint', 'The next round makes the order’s leaf. Keep the wallet open until its round is final and the wallet has listed it; then takers fill it in the tree while you are away, and each fill’s credit is yours at the wallet’s next sync.'));
  b.onclick = async () => {
    say('restStatus', '', '');
    try {
      if (sell.value === want.value) throw new Error('an order sells one asset for another');
      const r = rateOf(amount.value.trim(), total.value.trim());
      const params = { sell: sell.value, want: want.value, amount: amount.value.trim(), rate_num: r.num, rate_den: r.den };
      if (lot.value.trim()) params.min_lot = lot.value.trim();
      b.disabled = true;
      say('restStatus', '', 'Waiting for your approval in the wallet…');
      const out = await P.request('restOrder', params);
      say('restStatus', 'ok', `Rested: order ${short(out.order, 16)} (${out.state}). Its round makes the leaf; the wallet lists it once the operator holds it.`);
      await refresh();
    } catch (e) {
      say('restStatus', 'err', e.message);
    } finally { b.disabled = false; }
  };
}

async function fillResting(r, amount, btn) {
  say('restFillStatus', '', 'Waiting for your approval in the wallet…');
  btn.disabled = true;
  try {
    const params = { order: r.offer };
    if (amount) params.amount = amount;
    const out = await P.request('fillRestingOrder', params);
    const t = out.answer && out.answer.transfer_id;
    say('restFillStatus', 'ok', `Filled ${out.filled} for ${out.paid} + fee ${out.fee}${t ? ' (transfer ' + short(t, 16) + ')' : ''}${out.moved_from ? '; the order had moved from ' + short(out.moved_from, 12) + ', and was filled where it rests now' : ''}.`);
    await refresh();
  } catch (e) {
    say('restFillStatus', 'err', e.message);
  } finally { btn.disabled = false; }
}

async function cancelResting(o, btn) {
  say('restCancelStatus', '', 'Waiting for your approval in the wallet…');
  btn.disabled = true;
  try {
    const out = await P.request('cancelRestingOrder', { order: o.order });
    say('restCancelStatus', 'ok', `Cancelled order ${short(out.order, 16)}: what rested is a leaf of yours again.`);
    await refresh();
  } catch (e) {
    say('restCancelStatus', 'err', e.message);
  } finally { btn.disabled = false; }
}

async function take(r, amount, btn) {
  say('takeStatus', '', 'Waiting for your approval in the wallet…');
  btn.disabled = true;
  try {
    const params = { order: r.offer };
    if (amount) params.amount = amount;
    const out = await P.request('takeOrder', params);
    say('takeStatus', 'ok', `Submitted: take ${short(out.take, 16)} of ${out.filled} for ${out.price} + fee ${out.fee}. Keep the browser running with the wallet unlocked until its forfeits are handed over.`);
    await refresh();
  } catch (e) {
    say('takeStatus', 'err', e.message);
  } finally { btn.disabled = false; }
}

// ---- reading ----
const pairKey = (pair) => (pair ? pair.base_asset + '/' + pair.quote_asset : '');

async function fillsOf(base, quote) {
  const r = await fetch(`${MOUNTS.chain}/v1/market/${encodeURIComponent(base)}/${encodeURIComponent(quote)}/fills`, { cache: 'no-store' });
  if (!r.ok) throw new Error('relay HTTP ' + r.status);
  return (await r.json()).fills || [];
}

async function readAll() {
  if (!P.account()) { S.rows = []; return; }
  if (!S.operator) {
    try { S.operator = await P.request('getLeafOperator'); S.opErr = null; } catch (e) { S.opErr = e.message; }
  }
  const [takes, orders, bal, mine] = await Promise.allSettled([P.request('getLeafTakes'), P.request('getLeafOrders'), P.request('getLeafBalances'),
    P.request('getRestingOrders')]);
  if (takes.status === 'fulfilled') S.takes = takes.value.takes || [];
  if (mine.status === 'fulfilled') S.myResting = mine.value.orders || [];
  if (orders.status === 'fulfilled') S.orders = orders.value.orders || [];
  if (bal.status === 'fulfilled') S.balances = bal.value;
  const rows = [];
  const fills = new Map();
  const resting = [];
  if (S.operator) {
    let mkts = [];
    try { mkts = await markets('chain'); } catch { /* the book is unreachable: no rows */ }
    const pairs = mkts.filter((m) => !m.confidential && m.quote !== 'BTC' && servesPair(S.operator, m.base, m.quote));
    // The pairs of your own fills too, whose records say where each stands. The
    // relay's market list leaves out a market whose only order is held for a fill
    // that is not final, and its book still serves that order: read it all the same.
    for (const t of S.takes) if (t.pair && !pairs.some((m) => m.base === t.pair.base_asset && m.quote === t.pair.quote_asset)) pairs.push({ base: t.pair.base_asset, quote: t.pair.quote_asset });
    for (const m of pairs) {
      try { fills.set(m.base + '/' + m.quote, await fillsOf(m.base, m.quote)); } catch { fills.set(m.base + '/' + m.quote, []); }
      let offers = [];
      try { offers = unexpired(await orderbook('chain', m.base, m.quote)); } catch { continue; }
      for (const o of offers) {
        if (o.resting) {
          const r = restingRow(o.raw, fills.get(m.base + '/' + m.quote), S.operator.operator);
          if (r) resting.push(r);
          continue;
        }
        if (!o.covenant || o.side !== 'ask') continue;
        let state = fillableState(o.raw, fills.get(m.base + '/' + m.quote));
        const at = covenantOutpoint(o.raw);
        const mine = S.takes.find((t) => t.order === at && !['void', 'released'].includes(t.stage));
        if (state.fillable && mine) state = { ...state, fillable: false, why: 'your fill of it is under way (below)' };
        rows.push({ offer: o.raw, state });
      }
    }
  }
  S.rows = rows;
  S.fills = fills;
  S.resting = resting;
}

function busy() {
  return S.takes.some((t) => !['final', 'void'].includes(takeView(t, S.fills.get(pairKey(t.pair)) || []).key))
    || S.orders.some((o) => ['waiting', 'in_round', 'unlocking'].includes(o.state) || (o.state === 'resting' && !o.posted))
    || S.myResting.some((o) => o.state === 'participating' || (o.state === 'resting' && !o.listed))
    || S.resting.some((r) => r.fills.some((f) => f.state !== 'final'));
}

// One read at a time; a refresh asked for while one runs runs once more after it, so
// what changed meanwhile (a connect, a take) is never left undrawn.
async function refresh() {
  if (S.mode !== 'developer') return;
  if (S.busy) { S.again = true; return S.busy; }
  S.busy = (async () => {
    do {
      S.again = false;
      await readAll();
      if (S.mode !== 'developer') return;
      drawOperator(); drawOrders(); drawTakes(); drawMine(); drawResting(); drawMyResting(); drawLeaves();
      // The forms' assets are the operator's: drawn again once they are known.
      const sel = $('plSell'), n = ((S.operator && S.operator.assets) || []).length;
      if (P.account() && (!sel || sel.options.length !== n)) drawPlace();
      const rsel = $('rsSell');
      if (P.account() && (!rsel || rsel.options.length !== n)) drawRest();
    } while (S.again);
  })().finally(() => { S.busy = null; });
  return S.busy;
}

function schedule() {
  clearTimeout(S.timer);
  if (S.mode !== 'developer') return;
  S.timer = setTimeout(async () => { await refresh().catch(() => {}); schedule(); }, busy() ? POLL_BUSY_MS : POLL_IDLE_MS);
}

async function apply(mode) {
  S.mode = mode;
  if (mode !== 'developer') { clearTimeout(S.timer); drawAbsent(); return; }
  drawRoom();
  await refresh().catch(() => {});
  drawPlace(); drawRest();
  schedule();
}

P.onAccountChange(() => { if (S.mode === 'developer') { S.operator = null; drawRoom(); refresh().then(() => { drawPlace(); drawRest(); }).catch(() => {}); } });
P.onProvider(() => {
  P.onEvent('modeChanged', (d) => apply(d && d.mode));
  P.onEvent('leafTake', () => refresh().catch(() => {}));
  P.onEvent('leafArrived', () => refresh().catch(() => {}));
});
await apply(await readMode());
