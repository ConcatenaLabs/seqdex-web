// A pair's page: its price and the day beside the Tickers panel, the chart (price or depth),
// the book and recent trades, the order ticket, and your orders. The pair is shown the way
// round the link names it (any asset can price any other); the book is read once and
// turned round for display when needed, and an order goes to the wallet in the market's
// own direction, the one the makers post in (`orient`). The wallet chooses how each trade
// settles (`placeOrder`); this page names none of the ways a trade can travel.
import { $, el } from '../shared/app.js';
import { assetMeta, assetByTicker, usdFor, priceUsd } from '../shared/meta.js';
import { MOUNTS } from '../shared/book.js';
import { orient, mergeBook, invertBook, remaindersOf, priceAtoms, amountAtoms, estimate, spendableOf } from '../shared/market-book.js';
import * as P from '../shared/provider.js';
import * as LW from '../shared/vendor/lightweight-charts/lightweight-charts.standalone.production.mjs';
import { createPriceChart, createDepthChart, RANGES, rangeOf } from '../shared/chart.js';
import { INDICATORS } from '../shared/indicators.js';
import { mountTickers, fmtPrice, fmtUsd, tk, pairParam } from './tickers-panel.js';
import { drawOrders, units } from './orders-view.js';

export { spendableOf };
const BOOK_POLL_MS = 10_000;
const DATA_POLL_MS = 10_000;
const ORDERS_POLL_MS = 10_000;
const DEPTH_ROWS = 12;
const IND_KEY = 'seqdex.indicators', RANGE_KEY = 'seqdex.range', TYPE_KEY = 'seqdex.chartType';
const prec = (h) => (h === 'BTC' ? 8 : (assetMeta(h).precision ?? 8));
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
const usd = (v) => (v == null || !isFinite(v) ? '' : '$' + v.toLocaleString('en-US', { minimumFractionDigits: v >= 1 ? 2 : 0, maximumFractionDigits: v >= 1 ? 2 : v >= 0.01 ? 4 : 6 }));
const pressOne = (box, btn) => { for (const b of box.querySelectorAll('button')) b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'); };

async function getJSON(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
async function bookOffers(mount, base, quote) {
  try {
    const j = await getJSON(`${MOUNTS[mount]}/v1/market/${base}/${quote}/orderbook`);
    return (j.offers || []).map((o, i) => {
      const st = (j.statuses || [])[i];
      return st && st.active_amount != null ? { ...o, _active: String(st.active_amount) } : o;
    });
  } catch { return []; }
}
async function relayList(mount, base, quote, what, q = 'limit=500') {
  try { return (await getJSON(`${MOUNTS[mount]}/v1/market/${base}/${quote}/${what}?${q}`))[what] || []; }
  catch { return []; }
}

// The pair a link names (`?pair=GOLD-USDX`, either way round), else null.
function linkedPair() {
  const want = (new URLSearchParams(location.search).get('pair') || '').split('-');
  if (want.length !== 2) return null;
  const id = (t) => (t.toUpperCase() === 'BTC' ? 'BTC' : assetByTicker(t) || assetByTicker(t, null));
  const a = id(want[0]), b = id(want[1]);
  return a && b && a !== b ? { base: a, quote: b } : null;
}

export async function runMarketPage() {
  let view = null;           // { base, quote } as shown
  let canon = null;          // the market's own direction, the one orders go in
  let inv = false;           // shown the other way round from canon
  let canonBook = null, book = null, ticker = null;
  let side = 'buy', type = 'market', busy = false, features = new Set();
  let rangeKey = store.get(RANGE_KEY, '1W'), chartType = store.get(TYPE_KEY, 'candles');
  const shown = new Set(store.get(IND_KEY, INDICATORS.filter((i) => i.on).map((i) => i.key)));
  let groupStep = null, balances = {}, ordTab = 'open', lastCandle = null;

  // ---- the chart ----
  const priceChart = createPriceChart(LW, $('priceChart'), { type: chartType, indicators: shown });
  const depthChart = createDepthChart(LW, $('depthChart'));
  let viewMode = 'price';
  const legend = $('legend');
  const showLegend = (c) => {
    legend.textContent = '';
    if (!c) return;
    for (const [k, v] of [['O', c.o], ['H', c.h], ['L', c.l], ['C', c.c]]) legend.appendChild(el('span', null, k + ' ' + fmtPrice(v)));
    const ch = c.o > 0 ? (c.c - c.o) / c.o * 100 : 0;
    legend.appendChild(el('span', ch >= 0 ? 'up' : 'down', (ch >= 0 ? '+' : '') + ch.toFixed(2) + '%'));
  };
  priceChart.onHover((c) => showLegend(c || lastCandle));
  for (const r of RANGES) {
    const b = el('button', null, r.key); b.type = 'button'; b.dataset.r = r.key;
    b.setAttribute('aria-pressed', r.key === rangeKey ? 'true' : 'false');
    b.onclick = () => { rangeKey = r.key; store.set(RANGE_KEY, rangeKey); pressOne($('rangeTabs'), b); refreshData(); };
    $('rangeTabs').appendChild(b);
  }
  for (const b of $('typeTabs').querySelectorAll('button')) {
    b.setAttribute('aria-pressed', b.dataset.t === chartType ? 'true' : 'false');
    b.onclick = () => { chartType = b.dataset.t; store.set(TYPE_KEY, chartType); pressOne($('typeTabs'), b); priceChart.setType(chartType); };
  }
  for (const b of $('viewTabs').querySelectorAll('button')) {
    b.onclick = () => {
      viewMode = b.dataset.v; pressOne($('viewTabs'), b);
      const d = viewMode === 'depth';
      $('priceChart').style.visibility = d ? 'hidden' : 'visible';
      $('depthChart').style.visibility = d ? 'visible' : 'hidden';
      for (const id of ['rangeTabs', 'typeTabs', 'indBtn']) $(id).style.visibility = d ? 'hidden' : 'visible';
      legend.hidden = d; $('chartNote').hidden = d;
      if (d) drawDepth();
    };
  }
  const menu = $('indMenu');
  for (const ind of INDICATORS) {
    const l = el('label');
    const c = el('input'); c.type = 'checkbox'; c.checked = shown.has(ind.key);
    c.onchange = () => { if (c.checked) shown.add(ind.key); else shown.delete(ind.key); store.set(IND_KEY, [...shown]); priceChart.setIndicators(shown); };
    const sw = el('span', 'sw'); sw.style.background = ind.color;
    l.appendChild(c); l.appendChild(sw); l.appendChild(document.createTextNode(ind.label));
    menu.appendChild(l);
  }
  $('indBtn').onclick = () => { menu.hidden = !menu.hidden; $('indBtn').setAttribute('aria-expanded', String(!menu.hidden)); };

  // ---- the pair ----
  function setPair(p, { push = false } = {}) {
    view = { base: p.base, quote: p.quote };
    canon = orient(p.base, p.quote, tk);
    inv = canon.base !== view.base;
    canonBook = book = ticker = null; groupStep = null; lastCandle = null;
    const u = new URL(location.href); u.searchParams.set('pair', pairParam(view.base, view.quote));
    if (push) history.pushState(null, '', u); else history.replaceState(null, '', u);
    document.title = tk(view.base) + ' / ' + tk(view.quote) + ' · SeqDEX';
    const n = $('pairName'); n.textContent = '';
    n.appendChild(document.createTextNode(tk(view.base) + ' '));
    n.appendChild(el('span', 'q', '/ ' + tk(view.quote)));
    $('sumAv').textContent = tk(view.base).slice(0, 2).toUpperCase();
    $('lastPrice').textContent = '-'; $('lastChange').textContent = ''; $('dayLine').textContent = '';
    for (const id of ['hPrice', 'htPrice']) $(id).textContent = 'Price ' + tk(view.quote);
    for (const id of ['hAmount', 'htAmount']) $(id).textContent = 'Amount ' + tk(view.base);
    for (const id of ['asks', 'bids', 'spread', 'trades']) $(id).textContent = '';
    tickers.redraw();
    renderForm();
    refreshBook(); refreshData(); refreshOrders(); readBalances();
  }
  $('flip').onclick = () => setPair({ base: view.quote, quote: view.base }, { push: true });
  $('pairName').onclick = () => { $('left').classList.toggle('open'); };

  const tickers = mountTickers($('tickers'), {
    compact: true,
    current: () => view,
    onPick: (r) => { $('left').classList.remove('open'); setPair({ base: r.base, quote: r.quote }, { push: true }); },
    onData: (list) => { if (!view && list.length) setPair(defaultPair(list)); },
  });
  function defaultPair(list) {
    let best = list[0];
    for (const t of list) if (Number(t.trades_24h || 0) > Number(best.trades_24h || 0)) best = t;
    return orient(best.base, best.quote, tk);
  }

  // ---- the market's data: ticker, candles, trades (the relay serves either direction) ----
  const unit = (p) => (p > 0 ? p * Math.pow(10, prec(view.base) - prec(view.quote)) : null);
  async function refreshData() {
    if (!view) return;
    const v = view, r = rangeOf(rangeKey);
    const path = `${MOUNTS.chain}/v1/market/${v.base}/${v.quote}`;
    const limit = r.span ? Math.min(1000, Math.ceil(r.span / r.interval) + 50) : 1000;
    const [tkr, cd, tr] = await Promise.all([
      getJSON(path + '/ticker').catch(() => null),
      getJSON(path + `/candles?interval=${r.interval}&limit=${limit}`).catch(() => null),
      getJSON(path + '/trades?limit=60').catch(() => null),
    ]);
    if (view !== v) return;
    ticker = tkr;
    const candles = ((cd && cd.candles) || []).map((c) => ({ t: c.t, o: unit(c.o), h: unit(c.h), l: unit(c.l), c: unit(c.c), v: Number(c.v) / Math.pow(10, prec(v.base)) }));
    priceChart.setCandles(candles, Math.floor(Date.now() / 1000), r);
    lastCandle = candles[candles.length - 1] || null;
    showLegend(lastCandle);
    $('chartNote').textContent = candles.length ? '' : 'No trades yet';
    paintSummary();
    paintTrades((tr && tr.trades) || []);
    if (book) paintBook();
  }
  function paintSummary() {
    const t = ticker || {};
    const last = unit(Number(t.last));
    $('lastPrice').textContent = last ? fmtPrice(last) : '-';
    const q = priceUsd(view.quote);
    $('lastPrice').title = last && q > 0 ? usd(last * q) : '';
    const lc = $('lastChange'); lc.textContent = ''; lc.className = 'num';
    if (t.change_pct_24h != null) { lc.classList.add(t.change_pct_24h >= 0 ? 'up' : 'down'); lc.textContent = (t.change_pct_24h >= 0 ? '+' : '') + Number(t.change_pct_24h).toFixed(2) + '%'; }
    const parts = [];
    if (t.trades_24h) {
      parts.push('H ' + fmtPrice(unit(Number(t.high_24h))), 'L ' + fmtPrice(unit(Number(t.low_24h))));
      const vu = usdFor(view.quote, Number(t.quote_volume_24h || 0));
      parts.push('Vol ' + (vu != null ? '$' + fmtUsd(vu) : fmtUsd(Number(t.quote_volume_24h || 0) / Math.pow(10, prec(view.quote)), 2) + ' ' + tk(view.quote)));
    } else parts.push(last ? 'No trades in the last 24 hours' : 'No trades yet');
    $('dayLine').textContent = parts.join(' · ');
  }
  function paintTrades(trades) {
    const box = $('trades'); box.textContent = '';
    if (!trades.length) { box.appendChild(el('p', 't-empty', 'No trades yet')); return; }
    for (const t of trades.slice().reverse().slice(0, 40)) {
      const row = el('div', 'row');
      row.appendChild(el('span', t.side === 'sell' ? 'down' : 'up', fmtPrice(unit(t.price))));
      row.appendChild(el('span', null, units(String(t.size), view.base)));
      row.appendChild(el('span', null, new Date(t.ts * 1000).toTimeString().slice(0, 8)));
      box.appendChild(row);
    }
  }

  // ---- the book: read in the market's direction, shown the way round the pair is ----
  async function refreshBook() {
    if (!view) return;
    const v = view, c = canon;
    const opts = { base: c.base, quote: c.quote, basePrec: prec(c.base), quotePrec: prec(c.quote),
      pools: await P.supports('dexFillPool').catch(() => false) };
    let offers = [];
    if (c.quote === 'BTC') offers = await bookOffers('ln', c.base, c.quote);
    else {
      const [ab, ba, fab, fba] = await Promise.all([
        bookOffers('chain', c.base, c.quote), bookOffers('chain', c.quote, c.base),
        relayList('chain', c.base, c.quote, 'fills'), relayList('chain', c.quote, c.base, 'fills'),
      ]);
      offers = [...ab, ...ba]; opts.remainders = remaindersOf([...fab, ...fba]);
    }
    if (view !== v) return;
    canonBook = mergeBook(offers, opts);
    book = inv ? invertBook(canonBook) : canonBook;
    paintBook();
    if (viewMode === 'depth') drawDepth();
    paintEstimate();
  }
  function stepsFor(p) {
    if (!(p > 0)) return [];
    const s = Math.pow(10, Math.floor(Math.log10(p)) - 4);
    return [s, s * 10, s * 100, s * 1000].map((x) => Number(x.toPrecision(1)));
  }
  function grouped(levels, step, up) {
    if (!step) return levels;
    const m = new Map();
    for (const l of levels) {
      const p = Number(((up ? Math.ceil(l.price / step - 1e-9) : Math.floor(l.price / step + 1e-9)) * step).toPrecision(12));
      const g = m.get(p) || { price: p, size: 0n, total: 0n, orders: 0 };
      g.size += l.size; g.total += l.total; g.orders += l.orders; m.set(p, g);
    }
    return [...m.values()].sort((a, b) => (up ? a.price - b.price : b.price - a.price));
  }
  function paintBook() {
    const best = book.best.ask ?? book.best.bid;
    const sel = $('groupStep');
    if (groupStep == null && best) {
      const steps = stepsFor(best);
      sel.textContent = '';
      for (const s of steps) { const o = el('option', null, String(s)); o.value = String(s); sel.appendChild(o); }
      groupStep = steps[0] || 0;
      sel.onchange = () => { groupStep = Number(sel.value); paintBook(); };
    }
    const asks = grouped(book.asks, groupStep, true).slice(0, DEPTH_ROWS);
    const bids = grouped(book.bids, groupStep, false).slice(0, DEPTH_ROWS);
    let run = 0n; const ad = asks.map((l) => (run += l.size)); run = 0n; const bd = bids.map((l) => (run += l.size));
    const max = Number([...ad, ...bd].reduce((a, b) => (b > a ? b : a), 0n)) || 1;
    const row = (l, depth, cls) => {
      const r = el('div', 'row ' + cls);
      r.appendChild(el('span', null, fmtPrice(l.price)));
      r.appendChild(el('span', null, units(l.size, view.base)));
      const u = usdFor(view.quote, l.total);
      r.appendChild(el('span', null, u != null ? '$' + fmtUsd(u) : units(l.total, view.quote)));
      const bar = el('i', 'bar'); bar.style.width = (Number(depth) / max * 100).toFixed(1) + '%'; r.appendChild(bar);
      r.title = l.orders + (l.orders === 1 ? ' order' : ' orders');
      r.onclick = () => { if (type !== 'market' && $('fPrice')) { $('fPrice').value = String(+l.price.toPrecision(10)); paintEstimate(); } };
      return r;
    };
    $('asks').textContent = ''; $('bids').textContent = '';
    asks.forEach((l, i) => $('asks').prepend(row(l, ad[i], 'ask')));
    bids.forEach((l, i) => $('bids').appendChild(row(l, bd[i], 'bid')));
    const sp = $('spread'); sp.textContent = '';
    const last = ticker ? unit(Number(ticker.last)) : null;
    sp.appendChild(el('span', 'l', last ? fmtPrice(last) : '-'));
    const a = book.best.ask, b = book.best.bid;
    sp.appendChild(el('span', 's', a != null && b != null
      ? 'Spread ' + ((a - b) / ((a + b) / 2) * 100).toFixed(2) + '% · Mid ' + fmtPrice((a + b) / 2)
      : a == null && b == null ? 'Nobody is buying or selling right now' : a == null ? 'Only buyers right now' : 'Only sellers right now'));
    const bt = Number(bd.at(-1) || 0n), at = Number(ad.at(-1) || 0n), tot = bt + at;
    const bp = tot > 0 ? Math.round(bt / tot * 100) : 50;
    $('depB').style.width = bp + '%'; $('depS').style.width = (100 - bp) + '%';
    $('depBl').textContent = 'Buyers ' + bp + '%'; $('depSl').textContent = 'Sellers ' + (100 - bp) + '%';
  }
  function drawDepth() {
    if (!book) return;
    const u = (l) => ({ price: l.price, size: Number(l.size) / Math.pow(10, prec(view.base)) });
    depthChart.setBook(book.bids.map(u), book.asks.map(u));
  }
  for (const b of $('bookTabs').querySelectorAll('button')) {
    b.onclick = () => { pressOne($('bookTabs'), b); const t = b.dataset.b === 'trades'; $('bookPane').hidden = t; $('tradesPane').hidden = !t; $('groupStep').style.visibility = t ? 'hidden' : 'visible'; };
  }

  // ---- the order ticket ----
  // What the ticket's amount is in: the shown base, or, for a pair shown the other way
  // round from its market, the shown quote (what is spent on a buy, received on a sale),
  // so every amount the wallet is asked for is exact.
  const amountAsset = () => (inv ? view.quote : view.base);
  function renderForm() {
    const box = $('orderForm'); box.textContent = '';
    const sides = el('div', 't-sides');
    for (const s of ['buy', 'sell']) {
      const b = el('button', s, (s === 'buy' ? 'Buy ' : 'Sell ') + tk(view.base)); b.type = 'button'; b.id = 'side-' + s;
      b.setAttribute('aria-pressed', side === s ? 'true' : 'false');
      b.onclick = () => { side = s; renderForm(); };
      sides.appendChild(b);
    }
    box.appendChild(sides);
    const types = el('div', 't-tabs');
    const kinds = [['market', 'Market'], ['limit', 'Limit']];
    if (features.has('order-auction')) kinds.push(['auction', 'Auction']);
    if (!kinds.some(([k]) => k === type)) type = 'market';
    for (const [k, label] of kinds) {
      const b = el('button', null, label); b.type = 'button'; b.id = 'type-' + k;
      b.setAttribute('aria-pressed', type === k ? 'true' : 'false');
      b.onclick = () => { type = k; renderForm(); };
      types.appendChild(b);
    }
    box.appendChild(types);
    if (type === 'auction') box.appendChild(el('p', 't-small', 'Trades at the next auction\'s one price, at your limit or better.'));
    const field = (id, label, hint, unitText) => {
      const f = el('label', 't-fld'); f.htmlFor = id;
      const k = el('span', 'k t-k', label); if (hint) k.appendChild(el('em', null, hint)); f.appendChild(k);
      const v = el('span', 'v');
      const i = el('input'); i.id = id; i.type = 'text'; i.inputMode = 'decimal'; i.autocomplete = 'off'; i.spellcheck = false;
      i.addEventListener('input', paintEstimate);
      v.appendChild(i); v.appendChild(el('small', null, unitText)); f.appendChild(v);
      box.appendChild(f);
      return i;
    };
    if (type !== 'market') {
      const p = field('fPrice', 'Price', tk(view.quote) + ' per ' + tk(view.base), tk(view.quote));
      const best = side === 'buy' ? book && book.best.bid : book && book.best.ask;
      if (best != null) p.value = String(+best.toPrecision(10));
    }
    field('fAmount', inv ? (side === 'buy' ? 'You spend' : 'You receive') : 'Amount', '', tk(amountAsset()));
    const pcts = el('div', 't-pcts');
    for (const f of [0.25, 0.5, 0.75, 1]) {
      const b = el('button', null, f === 1 ? 'Max' : f * 100 + '%'); b.type = 'button';
      b.onclick = () => { const v = maxAmount(); if (v > 0) { $('fAmount').value = String(+(v * f).toFixed(prec(amountAsset()))); paintEstimate(); } };
      pcts.appendChild(b);
    }
    box.appendChild(pcts);
    const bal = el('div', 't-bal'); bal.id = 'fBal'; box.appendChild(bal);
    if (type === 'limit') renderOptions(box);
    const est = el('div', 't-est'); est.id = 'fEstimate'; box.appendChild(est);
    const go = el('button', 't-go ' + side); go.type = 'button'; go.id = 'fGo';
    box.appendChild(go);
    box.appendChild(el('p', 't-small', 'Your wallet shows the exact amounts and fees before anything is signed.'));
    const st = el('div', 'status'); st.id = 'fStatus'; st.setAttribute('role', 'status'); st.setAttribute('aria-live', 'polite');
    box.appendChild(st);
    go.onclick = submit;
    paintBalance(); paintEstimate();
  }
  // The limit options the wallet offers (getCapabilities' features); none is drawn otherwise.
  function renderOptions(box) {
    const opts = [];
    if (features.has('order-post-only')) opts.push(['optPostOnly', 'Post only', 'Rest on the book without taking any order.']);
    if (features.has('order-no-rest')) opts.push(['optNoRest', 'Nothing left resting', 'Take what is on offer at your price now; the rest is not placed.']);
    if (!opts.length && !features.has('order-min-fill') && !features.has('order-take-back-after')) return;
    const d = el('details', 't-opts');
    d.appendChild(el('summary', null, 'Options'));
    for (const [id, label, hint] of opts) {
      const l = el('label', 't-opt'); const c = el('input'); c.type = 'checkbox'; c.id = id;
      c.onchange = () => { if (c.checked) for (const o of ['optPostOnly', 'optNoRest']) if (o !== id && $(o)) $(o).checked = false; paintEstimate(); };
      const t = el('span', null, label); t.appendChild(el('small', null, hint));
      l.appendChild(c); l.appendChild(t); d.appendChild(l);
    }
    if (features.has('order-min-fill')) {
      const l = el('label', 't-opt'); l.appendChild(el('span', null, 'Smallest fill'));
      const i = el('input'); i.type = 'text'; i.id = 'optMinFill'; i.inputMode = 'decimal'; i.placeholder = '0'; i.style.width = '90px';
      l.appendChild(i); l.appendChild(el('span', 'faint', tk(amountAsset()))); d.appendChild(l);
    }
    if (features.has('order-take-back-after')) {
      const l = el('label', 't-opt'); const t = el('span', null, 'Can take back after');
      const s = el('select'); s.id = 'optTakeBack';
      for (const [v, w] of [['', 'the wallet\'s choice'], ['3600', '1 hour'], ['86400', '1 day'], ['604800', '1 week']]) { const o = el('option', null, w); o.value = v; s.appendChild(o); }
      t.appendChild(s); t.appendChild(el('small', null, 'Until then it stays on the book for anyone to fill at your price.'));
      l.appendChild(t); d.appendChild(l);
    }
    box.appendChild(d);
  }
  // What the ticket can spend, in the ticket's amount asset.
  function maxAmount() {
    const has = (h) => Number(balances[h] || 0) / Math.pow(10, prec(h));
    const px = Number($('fPrice') && $('fPrice').value) || (side === 'buy' ? book && book.best.ask : book && book.best.bid) || 0;
    if (!inv) return side === 'buy' ? (px > 0 ? has(view.quote) / px : 0) : has(view.base);
    return side === 'buy' ? has(view.quote) : has(view.base) * px;
  }
  function paintBalance() {
    const b = $('fBal'); if (!b) return;
    b.textContent = '';
    if (!P.account()) { b.appendChild(el('span', null, P.hasWallet() ? 'Connect the wallet to trade.' : P.NO_WALLET)); return; }
    const pay = side === 'buy' ? view.quote : view.base;
    b.appendChild(el('span', null, 'Balance'));
    b.appendChild(el('span', 'num', units(balances[pay] || '0', pay) + ' ' + tk(pay)));
  }
  // The order as the wallet takes it, in the market's direction: { side, amount (base
  // atoms), price (quote atoms per whole base, or null) }; throws on a bad entry.
  function canonOrder() {
    const cs = inv ? (side === 'buy' ? 'sell' : 'buy') : side;
    const amount = amountAtoms($('fAmount').value, prec(canon.base));
    let price = null;
    if (type !== 'market') {
      const p = Number($('fPrice').value);
      if (!(p > 0)) throw new Error('enter a price above zero');
      price = priceAtoms(inv ? (1 / p).toFixed(prec(canon.quote)) : $('fPrice').value.trim(), prec(canon.quote));
    }
    return { side: cs, amount, price };
  }
  function paintEstimate() {
    const box = $('fEstimate'), go = $('fGo');
    if (!box || !view) return;
    box.textContent = '';
    go.textContent = (side === 'buy' ? 'Buy ' : 'Sell ') + tk(view.base);
    let o;
    try { o = canonOrder(); } catch { return; }
    const line = (k, v) => { const d = el('div'); d.appendChild(el('span', null, k)); d.appendChild(el('span', null, v)); box.appendChild(d); };
    const amt = (atoms, h) => units(atoms, h) + ' ' + tk(h);
    const payGet = (r, cs) => (cs === 'buy' ? [[r.quote, canon.quote], [r.base, canon.base]] : [[r.base, canon.base], [r.quote, canon.quote]]);
    if (!inv) go.textContent = (side === 'buy' ? 'Buy ' : 'Sell ') + units(o.amount, view.base) + ' ' + tk(view.base);
    if (!canonBook) return;
    if (type === 'market') {
      const r = estimate(canonBook, o.side, o.amount);
      if (r.base === 0n) { line('The book', 'Nobody is ' + (o.side === 'buy' ? 'selling' : 'buying') + ' right now'); return; }
      const [pay, get] = payGet(r, o.side);
      line('You pay about', amt(pay[0], pay[1]));
      line('You get about', amt(get[0], get[1]));
      if (r.short) line('The book holds', 'only this much now');
      return;
    }
    // A limit: what fills now at the price or better, and what rests.
    const lp = Number(o.price) / Math.pow(10, prec(canon.quote));
    const levels = o.side === 'buy' ? canonBook.asks.filter((l) => l.price <= lp * (1 + 1e-9)) : canonBook.bids.filter((l) => l.price >= lp * (1 - 1e-9));
    const r = estimate({ asks: levels, bids: levels }, o.side, o.amount);
    const rest = o.amount - r.base;
    if (r.base > 0n) line('Fills now', amt(r.base, canon.base));
    if (rest > 0n && !($('optNoRest') && $('optNoRest').checked)) line('Rests on the book', amt(rest, canon.base));
    const total = (o.amount * o.price) / 10n ** BigInt(prec(canon.base));
    line(o.side === 'buy' ? 'You pay at most' : 'You get at least', amt(total, canon.quote));
  }
  async function submit() {
    const st = $('fStatus'), go = $('fGo');
    st.className = 'status'; st.textContent = '';
    if (busy) return;
    let params;
    try {
      const o = canonOrder();
      params = { type, base: canon.base, quote: canon.quote, side: o.side, amount: o.amount.toString() };
      if (o.price != null) params.price = o.price.toString();
      if (type === 'limit') {
        if ($('optPostOnly') && $('optPostOnly').checked) params.post_only = true;
        if ($('optNoRest') && $('optNoRest').checked) params.rest = false;
        if ($('optMinFill') && $('optMinFill').value) params.min_fill = amountAtoms($('optMinFill').value, prec(canon.base)).toString();
        if ($('optTakeBack') && $('optTakeBack').value) params.take_back_after = Number($('optTakeBack').value);
      }
    } catch (e) { st.className = 'status err'; st.textContent = e.message; return; }
    if (!P.hasWallet()) { st.className = 'status err'; st.textContent = P.NO_WALLET; return; }
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
      closeSheet();
      refreshOrders(); refreshBook(); readBalances();
    } catch (e) {
      st.className = 'status err';
      const m = (e && e.message) || String(e);
      st.textContent = /reject|declin|denied/i.test(m) ? 'You declined in the wallet. Nothing was traded.' : m;
    } finally { busy = false; go.disabled = false; paintEstimate(); }
  }

  // ---- the phone: the ticket opens as a sheet from Buy or Sell ----
  const openSheet = (s) => { side = s; renderForm(); $('ticketCard').classList.add('open'); $('shade').classList.add('open'); };
  function closeSheet() { $('ticketCard').classList.remove('open'); $('shade').classList.remove('open'); }
  $('phBuy').onclick = () => openSheet('buy');
  $('phSell').onclick = () => openSheet('sell');
  $('shade').onclick = closeSheet;

  // ---- the wallet: balances, features, orders ----
  async function readBalances() {
    if (!P.account()) { balances = {}; paintBalance(); return; }
    try { balances = spendableOf(await P.getBalances()); } catch { balances = {}; }
    paintBalance();
  }
  async function readFeatures() {
    const f = await P.features();
    const changed = [...f].sort().join() !== [...features].sort().join();
    features = f;
    if (changed && view) renderForm();
  }
  async function refreshOrders() {
    await drawOrders($('ordersBox'), $('ordersNote'), { tab: ordTab, market: $('thisMarket').checked ? view : null, onChange: () => { refreshOrders(); readBalances(); } });
  }
  for (const b of $('ordTabs').querySelectorAll('button')) b.onclick = () => { ordTab = b.dataset.o; pressOne($('ordTabs'), b); refreshOrders(); };
  $('thisMarket').onchange = refreshOrders;
  P.onAccountChange(() => { readBalances(); readFeatures(); refreshOrders(); });
  window.addEventListener('popstate', () => { const p = linkedPair(); if (p) setPair(p); });

  const linked = linkedPair();
  if (linked) setPair(linked);
  readFeatures();
  const timers = [setInterval(refreshBook, BOOK_POLL_MS), setInterval(refreshData, DATA_POLL_MS), setInterval(refreshOrders, ORDERS_POLL_MS)];
  window.addEventListener('pagehide', () => timers.forEach(clearInterval));
}
