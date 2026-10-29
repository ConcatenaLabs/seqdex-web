// The Tickers panel: every market priced every way round, grouped by base, from the relay's
// one answer for every market (/v1/tickers). A search box (base or quote) and the asset to
// price in ("Any" lists every asset with a row for each asset it trades against). The
// Markets page shows it whole; a pair's page shows it compact beside the chart.
import { el } from '../shared/app.js';
import { assetMeta, priceUsd, fmtAtoms } from '../shared/meta.js';
import { MOUNTS } from '../shared/book.js';
import { ANY, tickerGroups, anchorsOf, TICKER_WORDS as W } from '../shared/tickers.js';
import { sparkSvg } from '../shared/chart.js';
import { go } from './nav.js';
import { openPicker, PICKER_WORDS } from '../shared/asset-picker.js';
import { state as wallet } from './store.js';

const POLL_MS = 15_000;
const FAV_KEY = 'seqdex.favourites';
export const tk = (h) => (h === 'BTC' ? 'BTC' : assetMeta(h).ticker);
const refPrice = (h) => priceUsd(h);

// A price in its quote: six significant figures, grouped.
export function fmtPrice(v) {
  if (v == null || !(v > 0) || !isFinite(v)) return '-';
  const d = v >= 1000 ? 2 : v >= 1 ? 4 : Math.min(12, 5 - Math.floor(Math.log10(v)));
  return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
export const fmtUsd = (v, digits = 0) => (v == null ? '-' : v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }));
const fmtChange = (c) => (c == null ? el('span', 'faint', '-') : el('span', c >= 0 ? 'up' : 'down', (c >= 0 ? '+' : '') + c.toFixed(2) + '%'));
export const pairParam = (base, quote) => tk(base) + '-' + tk(quote);

function favourites() {
  try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]')); } catch { return new Set(); }
}
function saveFavourites(s) { try { localStorage.setItem(FAV_KEY, JSON.stringify([...s])); } catch { /* kept for this visit */ } }

export async function fetchTickers() {
  const r = await fetch(MOUNTS.chain + '/v1/tickers', { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return (await r.json()).tickers || [];
}

// Mounts the panel in host. opts: compact (the pair page's), current ({ base, quote } shown
// now), onPick(row) (default: open the pair's page), held() -> Set of asset ids the wallet
// holds (for "You hold"), onData(tickers) (each answer, for the page's own figures).
export function mountTickers(host, opts = {}) {
  const compact = !!opts.compact;
  let tickers = [], anchor = ANY, search = '', only = null, favs = favourites();
  host.textContent = '';
  const ctl = el('div', 't-ctl');
  const q = el('input'); q.type = 'search'; q.placeholder = W.search; q.setAttribute('aria-label', W.search); q.autocomplete = 'off';
  const lab = el('label', 't-k', W.anchor); lab.htmlFor = 'tkAnchor' + (compact ? 'S' : '');
  // "Priced in": the shared asset chooser, Any pinned on top, then your assets with their
  // balances, then every asset that prices a market.
  const sel = el('button', 't-anchor'); sel.type = 'button'; sel.id = lab.htmlFor;
  sel.setAttribute('aria-haspopup', 'listbox'); sel.setAttribute('aria-expanded', 'false');
  const selName = el('span', null, W.any); sel.appendChild(selName); sel.appendChild(el('span', 'caret', '▾'));
  ctl.appendChild(q);
  if (!compact) ctl.appendChild(lab);
  else sel.title = W.anchor;
  ctl.appendChild(sel);
  host.appendChild(ctl);
  let filters = null;
  if (!compact) {
    filters = el('div', 't-tabs');
    for (const [k, label] of [['fav', '★ Favourites'], ['held', 'You hold']]) {
      const b = el('button', null, label); b.type = 'button'; b.dataset.k = k; b.setAttribute('aria-pressed', 'false');
      b.onclick = () => { only = only === k ? null : k; for (const x of filters.children) x.setAttribute('aria-pressed', x.dataset.k === only ? 'true' : 'false'); draw(); };
      filters.appendChild(b);
    }
    ctl.appendChild(filters);
  }
  const box = el('div', 't-tkbox');
  const table = el('table', 't-tkr');
  const head = el('tr');
  const cols = compact
    ? [['Name', ''], [W.last, 'r'], [W.change, 'r'], ['Vol USD', 'r']]
    : [['', 'wide'], ['Name', ''], [W.last, 'r'], [W.change, 'r'], ['24h high / low', 'r wide'], ['Volume USD', 'r'], ['7 days', 'wide'], ['', 'wide']];
  for (const [t, c] of cols) { const th = el('th', c, t); head.appendChild(th); }
  const thead = el('thead'); thead.appendChild(head); table.appendChild(thead);
  const body = el('tbody'); table.appendChild(body);
  box.appendChild(table);
  host.appendChild(box);
  const status = el('p', 't-empty'); status.hidden = true; host.appendChild(status);

  const pick = opts.onPick || ((r) => go('market.html?pair=' + encodeURIComponent(pairParam(r.base, r.quote))));
  q.addEventListener('input', () => { search = q.value; draw(); });
  sel.addEventListener('click', () => {
    const prec = (h) => (h === 'BTC' ? 8 : (assetMeta(h).precision ?? 8));
    const items = anchorsOf(tickers, tk).map((h) => {
      if (h === ANY) return { hex: ANY, ticker: W.any, name: 'Every market', pin: true, cur: anchor === ANY };
      let atoms = 0n; try { atoms = BigInt(wallet.held[h] || 0); } catch {}
      const v = priceUsd(h) > 0 && atoms > 0n ? '$' + fmtUsd(Number(atoms) / 10 ** prec(h) * priceUsd(h), 2) : '';
      return { hex: h, ticker: tk(h), name: h === 'BTC' ? 'Bitcoin' : (assetMeta(h).name || ''), held: atoms > 0n, tradable: true, cur: anchor === h,
        bal: atoms > 0n ? { b: fmtAtoms(atoms, prec(h)), r: v } : null };
    });
    openPicker(sel, items, (h) => { setAnchor(h); draw(); }, { hint: PICKER_WORDS.hintSearch });
  });
  function setAnchor(h) { anchor = h; sel.dataset.value = h; selName.textContent = h === ANY ? W.any : tk(h); }
  setAnchor(ANY);

  // The asset prices are in stays chosen while it prices some market.
  function fillAnchors() {
    if (!anchorsOf(tickers, tk).includes(anchor)) setAnchor(ANY);
  }
  function draw() {
    let groups = tickerGroups(tickers, { anchor, search, meta: assetMeta, refPrice, tickerOf: tk });
    if (only === 'fav') groups = groups.map((g) => ({ ...g, rows: g.rows.filter((r) => favs.has(r.base + '/' + r.quote)) })).filter((g) => g.rows.length);
    if (only === 'held' && opts.held) { const h = opts.held(); groups = groups.filter((g) => h.has(g.base)); }
    body.textContent = '';
    const cur = opts.current && opts.current();
    for (const g of groups) {
      g.rows.forEach((r, i) => {
        const tr = el('tr', (i ? '' : 'first') + (cur && cur.base === r.base && cur.quote === r.quote ? ' cur' : ''));
        tr.dataset.pair = pairParam(r.base, r.quote);
        tr.onclick = () => pick(r);
        const key = r.base + '/' + r.quote;
        if (!compact) {
          const td = el('td', 'wide');
          const s = el('button', 'star', '★'); s.type = 'button'; s.title = 'Favourite';
          s.setAttribute('aria-pressed', favs.has(key) ? 'true' : 'false');
          s.onclick = (e) => { e.stopPropagation(); favs.has(key) ? favs.delete(key) : favs.add(key); saveFavourites(favs); s.setAttribute('aria-pressed', favs.has(key) ? 'true' : 'false'); };
          td.appendChild(s); tr.appendChild(td);
        }
        tr.appendChild(el('td', 'nm', i ? '' : tk(g.base)));
        const last = el('td', 'r', fmtPrice(r.last));
        last.appendChild(el('span', 'qt', tk(r.quote)));
        if (r.last == null) { last.textContent = ''; last.title = W.noTrades; last.appendChild(el('span', 'faint', '-')); last.appendChild(el('span', 'qt', tk(r.quote))); }
        tr.appendChild(last);
        const ch = el('td', 'r'); ch.appendChild(fmtChange(r.change)); tr.appendChild(ch);
        if (!compact) tr.appendChild(el('td', 'r faint wide', r.high ? fmtPrice(r.high) + ' / ' + fmtPrice(r.low) : ''));
        const v = r.volume;
        tr.appendChild(el('td', 'r', v == null ? '-' : compact ? (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : fmtUsd(v)) : fmtUsd(v)));
        if (!compact) {
          const sp = el('td', 'wide'); sp.innerHTML = sparkSvg(r.spark, { w: 96, h: 22 }); tr.appendChild(sp);
          const go = el('td', 'r wide'); const b = el('button', 't-btn', 'Trade'); b.type = 'button'; go.appendChild(b); tr.appendChild(go);
        }
        body.appendChild(tr);
      });
    }
    status.hidden = groups.length > 0;
    status.textContent = tickers.length ? W.none : 'Loading markets…';
  }
  let stopped = false;
  async function load() {
    try { tickers = await fetchTickers(); }
    catch { if (!tickers.length) { status.hidden = false; status.textContent = 'The markets are unreachable right now.'; } return; }
    if (stopped) return;
    fillAnchors();
    draw();
    if (opts.onData) opts.onData(tickers);
  }
  load();
  const timer = setInterval(load, POLL_MS);
  return { redraw: draw, tickers: () => tickers, stop: () => { stopped = true; clearInterval(timer); } };
}
