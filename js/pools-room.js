// The pools room (developer mode): the makers' pools the on-chain relay lists, each
// with its two quotes, what each side holds above its reserve, its reserves and the
// coins it rests at; and the clearing rounds the relay has seen, each at the one price
// its last output publishes, with the round orders it filled, the pools it moved, and
// where it stands. Read only: the room places nothing and holds nothing. Joined in
// shared/pool-room.js.
//
// The room exists only while the wallet says it is in developer mode
// (`getWalletMode`, then `modeChanged`); in user mode nothing of it is drawn.
import { initChrome, footer, $, el } from '../shared/app.js';
import { assetMeta, fmtAtoms } from '../shared/meta.js';
import { MOUNTS, markets, orderbook } from '../shared/book.js';
import { poolsOf, roundsOf } from '../shared/pool-room.js';
import * as P from '../shared/provider.js';

const POLL_MS = 10000;

await initChrome('pools.html');
footer();

const room = $('room');
const tk = (h) => assetMeta(h).ticker;
const amt = (atoms, h) => `${fmtAtoms(atoms, assetMeta(h).precision ?? 8)} ${tk(h)}`;
const short = (s, n = 12) => (s ? String(s).slice(0, n) + '…' : '');
const S = { mode: null, timer: null };

async function readMode() {
  try { return (await P.request('getWalletMode')).mode; } catch { return null; }
}

function panel(title) {
  const p = el('section', 'panel room-panel');
  p.appendChild(el('h2', null, title));
  return p;
}

function line(parent, label, value, mono) {
  const r = el('div', 'wrow');
  r.appendChild(el('span', 'sub', label));
  r.appendChild(el('span', mono ? 'amt mono' : 'amt', value));
  parent.appendChild(r);
}

async function allPoolOffers() {
  const mk = await markets('chain');
  const out = [];
  for (const m of mk) {
    if (m.confidential || m.base === 'BTC' || m.quote === 'BTC') continue;
    try { out.push(...(await orderbook('chain', m.base, m.quote)).map((n) => n.raw).filter((o) => o && o.pool)); } catch { /* one market unread */ }
  }
  return out;
}

async function draw() {
  if (S.mode !== 'developer') {
    room.textContent = '';
    room.appendChild(el('p', 'sub', P.hasWallet() ? 'Nothing here in the wallet’s current mode.' : 'Nothing here without a wallet.'));
    return;
  }
  document.title = 'Pools · SeqDEX';
  const [offers, rounds] = await Promise.all([
    allPoolOffers().catch(() => null),
    fetch(MOUNTS.chain + '/v1/rounds?limit=50', { cache: 'no-store' }).then((r) => r.json()).then((j) => j.rounds || []).catch(() => null),
  ]);
  room.textContent = '';
  const rules = el('div', 'rules');
  rules.appendChild(el('b', null, 'A pool is a maker’s two coins, one of each asset, that anyone fills on the chain at its quotes, never below the reserve its maker states. '));
  rules.appendChild(document.createTextNode('Each side lists what its coin holds above that reserve; only the maker’s key withdraws it. '
    + 'A clearing round fills round orders at one price, which its last output publishes, and may move pools at their quotes; '
    + 'it is final once its block is certified and its Bitcoin anchor buried, and a Bitcoin reorganisation can undo it until then.'));
  room.appendChild(rules);

  const pp = panel('Pools');
  if (offers == null) pp.appendChild(el('p', 'sub', 'The on-chain book is unreachable right now.'));
  else if (!offers.length) pp.appendChild(el('p', 'sub', 'No pool is listed.'));
  for (const p of poolsOf(offers || [])) {
    const card = el('div', 'panel');
    card.appendChild(el('h3', null, `${tk(p.base)} / ${tk(p.quote)}`));
    line(card, 'Ask', `${Number(p.ask.num) / Number(p.ask.den)} ${tk(p.quote)} per ${tk(p.base)} (${p.ask.num}/${p.ask.den} atoms) · sells ${p.askSide ? amt(p.askSide.listed, p.base) : 'not listed'}`);
    line(card, 'Bid', `${Number(p.bid.num) / Number(p.bid.den)} ${tk(p.quote)} per ${tk(p.base)} (${p.bid.num}/${p.bid.den} atoms) · pays ${p.bidSide ? amt(p.bidSide.listed, p.quote) : 'not listed'}`);
    line(card, 'Reserve', `${amt(p.reserveBase, p.base)} · ${amt(p.reserveQuote, p.quote)}; a fill moves at least ${amt(p.minLot, p.base)}`);
    line(card, 'Coins', p.coins ? `${short(p.coins.base, 16)} · ${short(p.coins.quote, 16)}` : '', true);
    line(card, 'Maker key', short(p.makerKey, 20), true);
    pp.appendChild(card);
  }
  room.appendChild(pp);

  const rp = panel('Clearing rounds');
  if (rounds == null) rp.appendChild(el('p', 'sub', 'The on-chain book is unreachable right now.'));
  else if (!rounds.length) rp.appendChild(el('p', 'sub', 'No clearing round has been seen.'));
  for (const r of roundsOf(rounds || [])) {
    const card = el('div', 'panel');
    const pr = r.d > 0n ? Number(r.n) / Number(r.d) : 0;
    card.appendChild(el('h3', null, `${pr} ${tk(r.quote)} per ${tk(r.base)}`));
    line(card, 'Price', `${r.n}/${r.d} atoms, read from the round’s last output`);
    line(card, 'Stands', r.words);
    line(card, 'Round', short(r.txid, 20), true);
    for (const f of r.fills) line(card, 'Order ' + short(f.offerId, 10), `credited ${f.paidAsset ? amt(f.credited, f.paidAsset) : f.credited}${f.rests > 0n ? '; rests again' : ''}`);
    for (const m of r.moves) line(card, 'Pool', `${m.sell ? 'sold' : 'bought'} ${amt(m.base, r.base)}; holds ${amt(m.after[0], r.base)} and ${amt(m.after[1], r.quote)}`);
    rp.appendChild(card);
  }
  room.appendChild(rp);
}

async function apply(mode) {
  S.mode = mode;
  clearTimeout(S.timer);
  await draw().catch(() => {});
  if (mode === 'developer') S.timer = setTimeout(() => apply(S.mode), POLL_MS);
}

P.onProvider(() => {
  P.onEvent('modeChanged', (d) => apply(d && d.mode));
});
await apply(await readMode());
