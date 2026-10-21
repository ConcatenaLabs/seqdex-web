// The default view: pick a market, read its book and its price, trade with one form and
// one button, and follow your orders. The wallet chooses how each trade settles
// (`placeOrder`), keeps your orders and trades (`getOrders`), and takes an order back
// (`cancelOrder`); this page names none of the ways a trade can travel.
import { $, el } from '../shared/app.js';
import { assetMeta, assetByTicker, fmtAtoms, usdFor, priceUsd, assetSupervised, supervisionNote } from '../shared/meta.js';
import { markets, MOUNTS } from '../shared/book.js';
import { pairsOf, mergeBook, remaindersOf, seriesOf, priceAtoms, amountAtoms, estimate, marketPrice, PRICE_WORDS } from '../shared/market-book.js';
import * as P from '../shared/provider.js';

const BOOK_POLL_MS = 15_000;
const ORDERS_POLL_MS = 10_000;
const PAIRS_POLL_MS = 60_000;
const DEPTH_ROWS = 10;
const LIST_PRICE_MAX_AGE_MS = 5 * 60_000;

const tk = (h) => (h === 'BTC' ? 'BTC' : assetMeta(h).ticker);
const prec = (h) => (h === 'BTC' ? 8 : (assetMeta(h).precision ?? 8));

// Money in the reference currency: two decimals from a dollar up, more below it.
export function usd(v) {
  if (v == null || !Number.isFinite(v)) return '';
  const a = Math.abs(v);
  const d = a >= 1 ? 2 : a >= 0.01 ? 4 : 6;
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: a >= 1 ? 2 : 0, maximumFractionDigits: d });
}
function units(atoms, h) {
  const s = fmtAtoms(atoms, prec(h));
  const [i, f] = s.split('.');
  return Number(i).toLocaleString('en-US') + (f ? '.' + f : '');
}
// A price in quote units per base unit, in the reference currency where the quote is
// priced, else in the quote itself.
function priceText(p, quote) {
  const q = priceUsd(quote);
  if (q > 0) return usd(p * q);
  return p.toPrecision(6).replace(/\.?0+$/, '') + ' ' + tk(quote);
}
function totalText(atoms, quote) {
  const v = usdFor(quote, atoms);
  return v != null ? usd(v) : units(atoms, quote) + ' ' + tk(quote);
}

async function getJSON(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
async function bookOffers(mount, base, quote) {
  try { return (await getJSON(`${MOUNTS[mount]}/v1/market/${base}/${quote}/orderbook`)).offers || []; }
  catch { return []; }
}
async function relayList(mount, base, quote, what) {
  try { return (await getJSON(`${MOUNTS[mount]}/v1/market/${base}/${quote}/${what}?limit=500`))[what] || []; }
  catch { return []; }
}

export async function runMarketPage() {
  let pairs = [], current = null, book = null, side = 'buy', type = 'market';
  let busy = false, picked = false;
  // Each market's one price (marketPrice), shared by its list entry and its header.
  const prices = new Map();   // key -> { price, kind, at } | null, with `fetched`
  const ordersNote = $('ordersNote');

  // ---- pairs ----
  async function heldAssets() {
    if (!P.account()) return [];
    try {
      const b = await P.getBalances();
      return Object.entries(b.assets || {}).filter(([h, v]) => BigInt(v || 0) > 0n && assetMeta(h).ticker && !assetMeta(h).ticker.endsWith('…')).map(([h]) => h);
    } catch { return []; }
  }
  async function loadPairs() {
    let chain = [], instant = [];
    try { chain = await markets('chain'); } catch {}
    try { instant = await markets('ln'); } catch {}
    // A market is listed by the books once it has an order. To place the first one, the
    // pairs of what the wallet holds are listed too (with each other and with BTC), and
    // the pair a link names.
    const extra = [];
    const held = await heldAssets();
    for (let i = 0; i < held.length; i++) {
      extra.push({ base: held[i], quote: 'BTC' });
      for (let j = i + 1; j < held.length; j++) extra.push({ base: held[i], quote: held[j] });
    }
    const want = (new URLSearchParams(location.search).get('pair') || '').split('-');
    if (want.length === 2) {
      // The issuer domain of the testnet's own assets first, so a look-alike ticker
      // elsewhere does not take a link's place.
      const id = (t) => (t.toUpperCase() === 'BTC' ? 'BTC' : assetByTicker(t) || assetByTicker(t, null));
      const a = id(want[0]), b = id(want[1]);
      if (a && b && a !== b) extra.push({ base: a, quote: b });
    }
    const list = pairsOf({
      chainMarkets: [...chain, ...extra.filter((m) => m.quote !== 'BTC' && m.base !== 'BTC')],
      instantMarkets: [...instant, ...extra.filter((m) => m.quote === 'BTC' || m.base === 'BTC')],
      refPrice: priceUsd, tickerOf: tk,
    });
    if (!list.length && !pairs.length) {
      $('pairList').textContent = '';
      $('pairList').appendChild(el('p', 'sub', chain.length || instant.length ? 'No markets right now.' : 'The markets are unreachable right now.'));
      return;
    }
    pairs = list.length ? list : pairs;
    renderPairs();
    fillListPrices();
    const linked = pairs.find((p) => want.length === 2 && (tk(p.base) + '-' + tk(p.quote)).toLowerCase() === want.join('-').toLowerCase());
    // The pair a link names, once it is known (a held asset's pair appears after the
    // wallet connects), unless the user has picked one since.
    if (!current || (linked && !picked && current.key !== linked.key)) select(linked || pairs[0]);
  }
  function renderPairs() {
    const box = $('pairList');
    box.textContent = '';
    for (const p of pairs) {
      const b = el('button', 'mkt');
      b.type = 'button';
      b.dataset.key = p.key;
      b.appendChild(el('span', 'pair', tk(p.base) + ' / ' + tk(p.quote)));
      if (assetSupervised(p.base) || assetSupervised(p.quote)) {
        const s = el('span', 'sup', '⊘'); s.title = supervisionNote(assetSupervised(p.base) ? p.base : p.quote); b.appendChild(s);
      }
      const n = el('span', 'n', listPriceText(p));
      const mp = prices.get(p.key);
      if (mp && mp.price != null) n.title = PRICE_WORDS[mp.kind];
      b.appendChild(n);
      const on = current && current.key === p.key;
      b.classList.toggle('on', !!on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.onclick = () => { picked = true; select(p); };
      box.appendChild(b);
    }
  }
  function listPriceText(p) {
    const mp = prices.get(p.key);
    return mp && mp.price != null ? priceText(mp.price, p.quote) : '';
  }
  function notePrice(p, mp) {
    prices.set(p.key, { ...(mp || { price: null }), fetched: Date.now() });
    const b = document.querySelector(`#pairList button.mkt[data-key="${p.key}"] .n`);
    if (b) { b.textContent = listPriceText(p); b.title = mp ? PRICE_WORDS[mp.kind] : ''; }
  }
  // The list's prices, read market by market (a few at a time) and kept a few minutes;
  // the market on screen keeps its own fresh with every refresh of its book.
  let filling = false;
  async function fillListPrices() {
    if (filling) return;
    filling = true;
    try {
      const due = pairs.filter((p) => { const c = prices.get(p.key); return !c || Date.now() - c.fetched > LIST_PRICE_MAX_AGE_MS; });
      let next = 0;
      const worker = async () => {
        for (;;) {
          const p = due[next++];
          if (!p) return;
          try { const m = await loadMarket(p); notePrice(p, marketPrice(m.book, m.series)); } catch { /* left blank */ }
        }
      };
      await Promise.all([worker(), worker(), worker()]);
    } finally { filling = false; }
  }

  function select(p) {
    if (!p) return;
    current = p; book = null;
    renderPairs();
    $('pairTitle').textContent = tk(p.base) + ' / ' + tk(p.quote);
    const u = new URL(location.href); u.searchParams.set('pair', tk(p.base) + '-' + tk(p.quote)); history.replaceState(null, '', u);
    $('bookBody').textContent = '';
    $('lastPrice').textContent = '';
    $('priceKind').textContent = '';
    renderForm();
    refreshBook();
    renderBalances();
  }

  // ---- book and chart ----
  // One market's merged book and its trades, as the chart plots them.
  async function loadMarket(p) {
    const opts = { base: p.base, quote: p.quote, basePrec: prec(p.base), quotePrec: prec(p.quote) };
    let offers = [], trades = [], reversed = [];
    if (p.quote === 'BTC') {
      offers = await bookOffers('ln', p.base, p.quote);
      trades = await relayList('ln', p.base, p.quote, 'trades');
    } else {
      const [ab, ba, fab, fba, tab, tba] = await Promise.all([
        bookOffers('chain', p.base, p.quote), bookOffers('chain', p.quote, p.base),
        relayList('chain', p.base, p.quote, 'fills'), relayList('chain', p.quote, p.base, 'fills'),
        relayList('chain', p.base, p.quote, 'trades'), relayList('chain', p.quote, p.base, 'trades'),
      ]);
      offers = [...ab, ...ba]; opts.remainders = remaindersOf([...fab, ...fba]); trades = tab; reversed = tba;
    }
    return { book: mergeBook(offers, opts), series: seriesOf({ trades, reversed, basePrec: opts.basePrec, quotePrec: opts.quotePrec }) };
  }
  async function refreshBook() {
    if (!current) return;
    const p = current;
    const m = await loadMarket(p);
    if (current !== p) return;
    book = m.book;
    renderBook();
    const mp = marketPrice(m.book, m.series);
    notePrice(p, mp);
    $('lastPrice').textContent = mp ? priceText(mp.price, p.quote) : '';
    $('priceKind').textContent = mp ? PRICE_WORDS[mp.kind] : 'no orders or trades yet';
    renderChart(m.series);
    paintEstimate();
  }
  function renderBook() {
    const body = $('bookBody');
    body.textContent = '';
    const p = current;
    $('bookAmountHead').textContent = 'Amount (' + tk(p.base) + ')';
    const asks = book.asks.slice(0, DEPTH_ROWS), bids = book.bids.slice(0, DEPTH_ROWS);
    const maxDepth = Number([...asks, ...bids].reduce((m, l) => (l.depth > m ? l.depth : m), 0n)) || 1;
    const row = (l, cls) => {
      const tr = el('tr', 'lvl ' + cls);
      tr.style.setProperty('--depth', (100 * Number(l.depth) / maxDepth).toFixed(1) + '%');
      tr.appendChild(el('td', cls, priceText(l.price, p.quote)));
      tr.appendChild(el('td', null, units(l.size, p.base)));
      tr.appendChild(el('td', 'faint', totalText(l.total, p.quote)));
      tr.title = l.orders + (l.orders === 1 ? ' order' : ' orders');
      tr.onclick = () => { if (type === 'limit') { $('fPrice').value = String(+l.price.toPrecision(10)); paintEstimate(); } };
      return tr;
    };
    for (const l of [...asks].reverse()) body.appendChild(row(l, 'ask'));
    const mid = el('tr', 'spread');
    const td = el('td', null, asks.length && bids.length ? 'spread ' + priceText(asks[0].price - bids[0].price, p.quote) : !asks.length && !bids.length ? 'No orders on this market right now.' : asks.length ? 'Only sellers right now' : 'Only buyers right now');
    td.colSpan = 3; mid.appendChild(td); body.appendChild(mid);
    for (const l of bids) body.appendChild(row(l, 'bid'));
  }
  function renderChart(pts) {
    const svg = $('chart');
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const note = $('chartNote');
    const q = priceUsd(current.quote);
    const val = (x) => (q > 0 ? x * q : x);
    if (pts.length < 2) { note.textContent = pts.length ? 'One trade so far, at ' + priceText(pts[0].price, current.quote) + '.' : 'No trades on this market yet.'; return; }
    note.textContent = 'Trades, ' + new Date(pts[0].t * 1000).toISOString().slice(0, 10) + ' to ' + new Date(pts.at(-1).t * 1000).toISOString().slice(0, 10)
      + (q > 0 ? ', valued at today’s price of ' + tk(current.quote) + '.' : '.');
    const W = 600, H = 160, pad = 6;
    const xs = pts.map((p) => p.t), ys = pts.map((p) => val(p.price));
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const sx = (x) => pad + (x1 > x0 ? ((x - x0) / (x1 - x0)) * (W - 2 * pad) : (W - 2 * pad) / 2);
    const sy = (y) => H - pad - (y1 > y0 ? ((y - y0) / (y1 - y0)) * (H - 2 * pad) : (H - 2 * pad) / 2);
    const ns = 'http://www.w3.org/2000/svg';
    const path = document.createElementNS(ns, 'polyline');
    path.setAttribute('points', pts.map((p) => sx(p.t).toFixed(1) + ',' + sy(val(p.price)).toFixed(1)).join(' '));
    path.setAttribute('class', 'line');
    svg.appendChild(path);
    for (const [y, label] of [[y1, q > 0 ? usd(y1) : y1.toPrecision(6)], [y0, q > 0 ? usd(y0) : y0.toPrecision(6)]]) {
      const t = document.createElementNS(ns, 'text');
      t.setAttribute('x', String(W - pad)); t.setAttribute('y', String(sy(y) + (y === y1 ? 12 : -4)));
      t.setAttribute('text-anchor', 'end'); t.setAttribute('class', 'axis');
      t.textContent = label;
      svg.appendChild(t);
    }
  }

  // ---- the order form ----
  function renderForm() {
    const box = $('orderForm');
    box.textContent = '';
    const p = current;
    const head = el('div', 'modes');
    head.appendChild(el('h2', null, 'Trade'));
    const seg = el('div', 'seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Order type');
    for (const t of ['market', 'limit']) {
      const b = el('button', 'linkbtn', t === 'market' ? 'Market' : 'Limit'); b.type = 'button'; b.id = 'type-' + t;
      b.setAttribute('aria-pressed', type === t ? 'true' : 'false');
      b.onclick = () => { type = t; renderForm(); };
      seg.appendChild(b);
    }
    head.appendChild(seg); box.appendChild(head);
    const sides = el('div', 'sides'); sides.setAttribute('role', 'group'); sides.setAttribute('aria-label', 'Side');
    for (const s of ['buy', 'sell']) {
      const b = el('button', 'btn toggle side-' + s, (s === 'buy' ? 'Buy ' : 'Sell ') + tk(p.base)); b.type = 'button'; b.id = 'side-' + s;
      b.setAttribute('aria-pressed', side === s ? 'true' : 'false');
      b.onclick = () => { side = s; renderForm(); };
      sides.appendChild(b);
    }
    box.appendChild(sides);
    const field = (id, label) => {
      const l = el('label', 'lbl', label); l.htmlFor = id; box.appendChild(l);
      const i = el('input', 'mono'); i.id = id; i.type = 'text'; i.inputMode = 'decimal'; i.autocomplete = 'off'; i.spellcheck = false;
      i.addEventListener('input', paintEstimate);
      box.appendChild(i);
      return i;
    };
    field('fAmount', 'Amount (' + tk(p.base) + ')');
    if (type === 'limit') {
      field('fPrice', 'Price (' + tk(p.quote) + ' per ' + tk(p.base) + ')');
      const best = side === 'buy' ? book && book.best.bid : book && book.best.ask;
      if (best != null) $('fPrice').value = String(+best.toPrecision(10));
    }
    const est = el('p', 'sub est'); est.id = 'fEstimate'; box.appendChild(est);
    const go = el('button', 'btn go go-' + side, (side === 'buy' ? 'Buy ' : 'Sell ') + tk(p.base)); go.type = 'button'; go.id = 'fGo';
    box.appendChild(go);
    const st = el('div', 'status'); st.id = 'fStatus'; st.setAttribute('role', 'status'); st.setAttribute('aria-live', 'polite');
    box.appendChild(st);
    go.onclick = submit;
    paintEstimate();
  }
  function paintEstimate() {
    const e = $('fEstimate');
    if (!e || !current) return;
    const p = current;
    e.textContent = '';
    let amount;
    try { amount = amountAtoms($('fAmount').value, prec(p.base)); } catch { return; }
    if (type === 'limit') {
      let pa;
      try { pa = priceAtoms($('fPrice').value, prec(p.quote)); } catch (err) { e.textContent = err.message; return; }
      const total = (amount * pa) / 10n ** BigInt(prec(p.base));
      const v = usdFor(p.quote, total);
      e.textContent = (side === 'buy' ? 'You pay at most ' : 'You get at least ') + units(total, p.quote) + ' ' + tk(p.quote) + (v != null ? ' (' + usd(v) + ')' : '')
        + (p.quote === 'BTC' ? '. Only what the book offers at your price now is traded.' : '. What does not trade now rests on the book at your price.');
      return;
    }
    if (!book) return;
    const r = estimate(book, side, amount);
    if (r.base === 0n) { e.textContent = 'Nothing on the book to ' + side + ' right now.'; return; }
    const v = usdFor(p.quote, r.quote);
    e.textContent = 'About ' + units(r.quote, p.quote) + ' ' + tk(p.quote) + (v != null ? ' (' + usd(v) + ')' : '')
      + (side === 'buy' ? ' to pay' : ' to get') + (r.short ? ', for the ' + units(r.base, p.base) + ' ' + tk(p.base) + ' the book holds' : '') + '. Your wallet shows the exact amounts before you approve.';
  }
  async function submit() {
    const st = $('fStatus'), go = $('fGo');
    st.className = 'status'; st.textContent = '';
    if (busy) return;
    const p = current;
    let params;
    try {
      const amount = amountAtoms($('fAmount').value, prec(p.base));
      params = { type, base: p.base, quote: p.quote, side, amount: amount.toString() };
      if (type === 'limit') params.price = priceAtoms($('fPrice').value, prec(p.quote)).toString();
    } catch (e) { st.className = 'status err'; st.textContent = e.message; return; }
    if (!P.hasWallet()) { st.className = 'status err'; st.textContent = 'Trading needs the Sequentia wallet extension.'; return; }
    busy = true; go.disabled = true;
    try {
      if (!P.account()) await P.connect();
      if (!(await P.supports('placeOrder'))) throw new Error('this version of the wallet cannot trade here; update it from the downloads page');
      st.textContent = 'Waiting for your approval in the wallet…';
      const r = await P.request('placeOrder', params);
      st.className = 'status ok';
      const parts = [];
      if (r.filled) parts.push('Traded with ' + r.filled + (r.filled === 1 ? ' order' : ' orders') + '.');
      if (r.order) parts.push(r.filled ? 'Your order for the rest is on the book.' : 'Your order is on the book.');
      if (r.order_error) parts.push('The rest was not placed: ' + r.order_error + '.');
      if (r.failed && r.failed.length) parts.push(r.failed.length + ' order' + (r.failed.length === 1 ? ' was' : 's were') + ' taken by someone else first; nothing of yours moved for ' + (r.failed.length === 1 ? 'it' : 'them') + '.');
      st.textContent = parts.join(' ') + ' Follow it under Your orders.';
      $('fAmount').value = '';
      refreshOrders(); refreshBook(); renderBalances();
    } catch (e) {
      st.className = 'status err';
      st.textContent = (e && e.message) || String(e);
    } finally { busy = false; go.disabled = false; }
  }

  // ---- balances ----
  async function renderBalances() {
    const box = $('balances');
    box.textContent = '';
    box.appendChild(el('h2', null, 'Your balances'));
    if (!P.account()) {
      box.appendChild(el('p', 'sub', P.hasWallet() ? 'Connect the wallet to see your balances.' : 'Trading needs the Sequentia wallet extension.'));
      return;
    }
    let b;
    try { b = await P.getBalances(); } catch (e) { box.appendChild(el('p', 'sub', 'The wallet is locked or unreachable: ' + e.message)); return; }
    for (const h of [current.base, current.quote]) {
      const atoms = h === 'BTC' ? (b.btc || '0') : ((b.assets || {})[h] || '0');
      const r = el('div', 'wrow');
      r.appendChild(el('span', 'tk', tk(h)));
      r.appendChild(el('span', 'amt', units(atoms, h)));
      const v = usdFor(h, atoms);
      r.appendChild(el('span', 'sub2', v != null ? usd(v) : ''));
      box.appendChild(r);
    }
  }

  // ---- your orders ----
  async function refreshOrders() {
    const open = $('openOrders'), hist = $('history');
    if (!P.account()) {
      open.textContent = ''; hist.textContent = '';
      ordersNote.textContent = P.hasWallet() ? 'Connect the wallet to see your orders.' : '';
      return;
    }
    let r;
    try {
      if (!(await P.supports('getOrders'))) { ordersNote.textContent = 'Update the wallet to see your orders here.'; return; }
      r = await P.request('getOrders');
    } catch (e) { ordersNote.textContent = 'Your orders are unreadable right now: ' + e.message; return; }
    ordersNote.textContent = '';
    const name = (m) => tk(m.base) + ' / ' + tk(m.quote);
    const when = (ms) => new Date(ms).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    const priceOf = (o) => priceText(Number(o.price) / Math.pow(10, prec(o.market.quote)), o.market.quote);
    // Open: resting orders not yet filled or taken back.
    open.textContent = '';
    const live = r.orders.filter((o) => ['placing', 'open', 'filling'].includes(o.state));
    if (!live.length) open.appendChild(el('p', 'sub', 'No open orders.'));
    for (const o of live.sort((a, b) => b.at - a.at)) {
      const d = el('div', 'order');
      d.dataset.order = o.order;
      const top = el('div', 'order-top');
      top.appendChild(el('b', o.side, (o.side === 'buy' ? 'Buy ' : 'Sell ') + units(o.amount, o.market.base) + ' ' + tk(o.market.base)));
      top.appendChild(el('span', null, ' at ' + priceOf(o) + ' · ' + name(o.market)));
      d.appendChild(top);
      const words = o.state === 'placing' ? 'Being placed on the book.'
        : o.state === 'filling' ? 'Filled; settling.'
        : 'Filled ' + units(o.filled, o.market.base) + ' of ' + units(o.amount, o.market.base) + ' ' + tk(o.market.base) + '.';
      d.appendChild(el('p', 'sub', words));
      if (o.can_take_back) {
        const b = el('button', 'btn ghost small', 'Take back what is left'); b.type = 'button';
        b.onclick = async () => {
          b.disabled = true;
          try { await P.request('cancelOrder', { order: o.order }); refreshOrders(); renderBalances(); }
          catch (e) { d.appendChild(el('p', 'status err', e.message)); b.disabled = false; }
        };
        d.appendChild(b);
      } else if (o.state !== 'filling') {
        d.appendChild(el('p', 'faint', 'It stays on the book until it is filled. What is left can be taken back from ' + o.take_back_from_text + '.'));
      }
      open.appendChild(d);
    }
    // History: trades made, and orders filled or taken back.
    hist.textContent = '';
    const rows = [];
    for (const t of r.trades) {
      for (const f of (t.fills || [])) {
        rows.push({ at: t.at, text: (t.side === 'buy' ? 'Bought ' : 'Sold ') + units(f.base, t.market.base) + ' ' + tk(t.market.base) + ' for ' + units(f.quote, t.market.quote) + ' ' + tk(t.market.quote), market: t.market, state: f.state, v: usdFor(t.market.quote, f.quote) });
      }
      if (t.kind === 'instant') rows.push({ at: t.at, text: (t.side === 'buy' ? 'Bought ' : 'Sold ') + units(t.base || '0', t.market.base) + ' ' + tk(t.market.base), market: t.market, state: t.state, v: usdFor(t.market.quote, t.quote || '0') });
    }
    for (const o of r.orders.filter((x) => x.state === 'filled' || x.state === 'withdrawn')) {
      const what = (o.side === 'buy' ? 'buy ' : 'sell ') + units(o.amount, o.market.base) + ' ' + tk(o.market.base) + ' at ' + priceOf(o);
      rows.push({ at: o.at, text: o.state === 'filled' ? 'Your order filled: ' + what
        : 'Your order taken back: ' + what + ', ' + units(o.filled, o.market.base) + ' of it filled', market: o.market, state: o.state === 'filled' ? (o.settled ? 'settled' : 'sent') : 'returned', v: null });
    }
    if (!rows.length) hist.appendChild(el('p', 'sub', 'Nothing yet.'));
    for (const h of rows.sort((a, b) => b.at - a.at)) {
      const d = el('div', 'hrow');
      d.appendChild(el('span', 'faint', when(h.at)));
      d.appendChild(el('span', null, h.text + (h.v != null ? ' (' + usd(h.v) + ')' : '')));
      d.appendChild(el('span', 'pill state-' + h.state, h.state === 'settled' ? 'Settled' : h.state === 'failed' ? 'Did not settle' : h.state === 'returned' ? 'Returned' : 'Sent'));
      hist.appendChild(d);
    }
  }

  P.onAccountChange(() => { renderBalances(); refreshOrders(); loadPairs(); });
  await loadPairs();
  refreshOrders();
  const timers = [setInterval(refreshBook, BOOK_POLL_MS), setInterval(refreshOrders, ORDERS_POLL_MS), setInterval(loadPairs, PAIRS_POLL_MS)];
  window.addEventListener('pagehide', () => timers.forEach(clearInterval));
}
