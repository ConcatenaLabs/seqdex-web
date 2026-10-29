// The Portfolio view: one total in the reference currency across every asset, then each asset's
// one figure wherever the wallet holds it (BTC first, then by value; the Sequence token is
// one row among equals), what is still arriving, your open orders, trades and order
// history, and the trades as a CSV file.
import { $, el } from '../shared/app.js';
import { assetMeta, usdFor, priceUsd } from '../shared/meta.js';
import * as P from '../shared/provider.js';
import { spendableOf, orient } from '../shared/market-book.js';
import { fmtPrice, fmtUsd, tk, pairParam } from './tickers-panel.js';
import { drawOrders, units } from './orders-view.js';
import { state, subscribe, refresh } from './store.js';

const COLORS = ['#f7931a', '#8fb8ff', '#e8b84a', '#4ade80', '#a78bfa', '#2dd4bf', '#f472b6', '#cbd5e1', '#fbbf24', '#60a5fa'];
const pressOne = (box, btn) => { for (const b of box.querySelectorAll('button')) b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'); };

const HTML = `
  <div class="t-pf-top">
    <div class="t-card t-total">
      <span class="t-k">Total</span>
      <div class="v" id="pfTotal">-</div>
      <div class="t-alloc" id="pfAlloc"></div>
      <div class="t-alleg" id="pfLegend"></div>
    </div>
    <div class="t-card" style="padding:14px 16px">
      <span class="t-k">Assets</span>
      <p class="t-small" id="pfNote" style="margin-top:6px">Each asset's one figure, wherever your wallet holds it, valued in US dollars. What has arrived and cannot be spent yet shows under its figure.</p>
    </div>
  </div>
  <div class="t-card"><div class="t-scroll"><table class="t-ord" id="pfAssets"><thead><tr><th>Asset</th><th class="r">Amount</th><th class="r wide">Price</th><th class="r">Value</th><th class="r wide">Share</th><th></th></tr></thead><tbody></tbody></table></div></div>
  <div class="t-card t-bottom">
    <div class="t-head">
      <div class="t-tabs" id="ordTabs"><button type="button" data-o="open" aria-pressed="true">Open orders</button><button type="button" data-o="trades" aria-pressed="false">Trades</button><button type="button" data-o="history" aria-pressed="false">Order history</button></div>
      <span class="t-sp"></span>
      <button type="button" class="t-btn" id="exportCsv">Export CSV</button>
    </div>
    <p id="ordersNote" class="t-empty" hidden></p>
    <div class="t-scroll" id="ordersBox"></div>
  </div>`;

export function mountPortfolio(root, life) {
  root.innerHTML = HTML;
  document.title = 'SeqDEX · Portfolio';
  let tab = 'open';

  function drawAssets() {
    const body = $('pfAssets').querySelector('tbody'); body.textContent = '';
    $('pfAlloc').textContent = ''; $('pfLegend').textContent = '';
    if (!P.account()) { $('pfTotal').textContent = '-'; $('pfNote').textContent = P.hasWallet() ? 'Connect the wallet to see what it holds.' : P.NO_WALLET; return; }
    if (state.balancesError) { $('pfNote').textContent = state.balancesError; return; }
    $('pfNote').textContent = 'Each asset\'s one figure, wherever your wallet holds it, valued in US dollars. What has arrived and cannot be spent yet shows under its figure.';
    const held = state.held, arriving = state.arriving;
    const rows = Object.entries(held)
      .filter(([h, v]) => h === 'BTC' || BigInt(v || 0) > 0n || BigInt(arriving[h] || 0) > 0n)
      .map(([h, v]) => ({ h, atoms: v, value: usdFor(h, v) }));
    if (!rows.some((r) => r.h === 'BTC')) rows.push({ h: 'BTC', atoms: '0', value: 0 });
    rows.sort((a, c) => (a.h === 'BTC' ? -1 : c.h === 'BTC' ? 1 : (c.value || 0) - (a.value || 0)));
    const total = rows.reduce((s, r) => s + (r.value || 0), 0);
    $('pfTotal').textContent = '$' + fmtUsd(total, 2);
    rows.forEach((r, i) => {
      const tr = el('tr');
      tr.appendChild(el('td', null, tk(r.h)));
      const a = el('td', 'r num', units(r.atoms, r.h) + ' ' + tk(r.h));
      if (BigInt(arriving[r.h] || 0) > 0n) a.appendChild(el('span', 't-arr', units(arriving[r.h], r.h) + ' ' + tk(r.h) + ' arriving'));
      tr.appendChild(a);
      const p = priceUsd(r.h);
      tr.appendChild(el('td', 'r num faint wide', p > 0 ? '$' + fmtPrice(p) : '-'));
      tr.appendChild(el('td', 'r num', r.value != null ? '$' + fmtUsd(r.value, 2) : '-'));
      tr.appendChild(el('td', 'r num faint wide', total > 0 && r.value ? (r.value / total * 100).toFixed(1) + '%' : ''));
      const go = el('td', 'r');
      if (r.h !== 'BTC' || rows.length > 1) {
        const other = r.h === 'BTC' ? rows.find((x) => x.h !== 'BTC').h : 'BTC';
        const p2 = orient(r.h, other, tk);
        const link = el('a', 't-btn', 'Trade'); link.href = 'market.html?pair=' + encodeURIComponent(pairParam(p2.base, p2.quote));
        go.appendChild(link);
      }
      tr.appendChild(go);
      body.appendChild(tr);
      if (total > 0 && r.value) {
        const c = COLORS[i % COLORS.length];
        const seg = el('div'); seg.style.width = (r.value / total * 100) + '%'; seg.style.background = c; seg.title = tk(r.h);
        $('pfAlloc').appendChild(seg);
        const lg = el('span'); const sw = el('i'); sw.style.background = c; lg.appendChild(sw);
        lg.appendChild(document.createTextNode(tk(r.h) + ' ' + (r.value / total * 100).toFixed(1) + '%'));
        $('pfLegend').appendChild(lg);
      }
    });
  }
  const drawTab = () => drawOrders($('ordersBox'), $('ordersNote'), { tab, market: null, onChange: refresh });
  for (const b of $('ordTabs').querySelectorAll('button')) b.onclick = () => { tab = b.dataset.o; pressOne($('ordTabs'), b); drawTab(); };

  // The trades as CSV: one line per fill, amounts in each asset's own units.
  $('exportCsv').onclick = () => {
    const rows = [['time', 'market', 'side', 'base', 'base_amount', 'quote', 'quote_amount', 'status']];
    for (const t of (state.orders && state.orders.trades) || []) {
      const fills = t.fills && t.fills.length ? t.fills : [{ base: t.base || '0', quote: t.quote || '0', state: t.state }];
      for (const f of fills) rows.push([new Date(t.at).toISOString(), tk(t.market.base) + '/' + tk(t.market.quote), t.side, tk(t.market.base), units(f.base, t.market.base).replace(/,/g, ''), tk(t.market.quote), units(f.quote, t.market.quote).replace(/,/g, ''), f.state || t.state]);
    }
    const csv = rows.map((r) => r.map((x) => (/[",\n]/.test(String(x)) ? '"' + String(x).replace(/"/g, '""') + '"' : x)).join(',')).join('\n');
    const a = el('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'seqdex-trades.csv';
    document.body.appendChild(a); a.click(); a.remove();
  };

  life.add(subscribe(() => { drawAssets(); drawTab(); }));
  return {};
}
