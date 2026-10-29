// Your orders and trades, as the pair page and the portfolio show them: open orders (how
// much is filled, and when what is left can be taken back), trades (each a row as in the
// wallets' history, Sent until final, then Settled) and order history. Everything comes
// from the wallet (`getOrders`, `cancelOrder`); this page reads, the wallet signs.
import { el } from '../shared/app.js';
import { assetMeta, fmtAtoms, usdFor } from '../shared/meta.js';
import * as P from '../shared/provider.js';
import { fmtPrice, fmtUsd } from './tickers-panel.js';

const tk = (h) => (h === 'BTC' ? 'BTC' : assetMeta(h).ticker);
const prec = (h) => (h === 'BTC' ? 8 : (assetMeta(h).precision ?? 8));
export function units(atoms, h) {
  const s = fmtAtoms(atoms, prec(h));
  const [i, f] = s.split('.');
  return Number(i).toLocaleString('en-US') + (f ? '.' + f : '');
}
const when = (ms) => new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const STATE_WORDS = { settled: 'Settled', sent: 'Sent', failed: 'Did not settle', returned: 'Returned' };

// Reads the wallet's orders and draws the chosen tab into box. opts: { tab: 'open' |
// 'trades' | 'history', market: { base, quote } | null (only that market, either way
// round), onChange() after an order is taken back }. Returns the wallet's answer.
export async function drawOrders(box, note, opts) {
  box.textContent = '';
  note.hidden = true;
  const say = (t) => { note.hidden = false; note.textContent = t; };
  if (!P.account()) { say(P.hasWallet() ? 'Connect the wallet to see your orders.' : P.NO_WALLET); return null; }
  let r;
  try {
    if (!(await P.supports('getOrders'))) { say('Update the wallet to see your orders here.'); return null; }
    r = await P.request('getOrders');
  } catch (e) { say('Your orders are unreadable right now: ' + e.message); return null; }
  const m = opts.market;
  const inMarket = (x) => !m || (x.market.base === m.base && x.market.quote === m.quote) || (x.market.base === m.quote && x.market.quote === m.base);
  const name = (mk) => tk(mk.base) + ' / ' + tk(mk.quote);
  const priceOf = (o) => fmtPrice(Number(o.price) / Math.pow(10, prec(o.market.quote))) + ' ' + tk(o.market.quote);
  const table = (cols) => {
    const t = el('table', 't-ord');
    const h = el('tr');
    for (const [c, cls] of cols) h.appendChild(el('th', cls || null, c));
    const th = el('thead'); th.appendChild(h); t.appendChild(th);
    const b = el('tbody'); t.appendChild(b);
    box.appendChild(t);
    return b;
  };
  const td = (tr, text, cls) => { const d = el('td', cls || null, text); tr.appendChild(d); return d; };

  if (opts.tab === 'open') {
    const live = r.orders.filter((o) => ['placing', 'open', 'filling'].includes(o.state) && inMarket(o)).sort((a, b) => b.at - a.at);
    if (!live.length) { say('No open orders.'); return r; }
    const body = table([['Placed', 'wide'], ['Market'], ['Side'], ['Price', 'r'], ['Amount', 'r'], ['Filled'], ['Can take back', 'wide'], ['', 'r']]);
    for (const o of live) {
      const tr = el('tr'); tr.dataset.order = o.order;
      td(tr, when(o.at), 'num faint wide');
      td(tr, name(o.market));
      td(tr, o.side === 'buy' ? 'Buy' : 'Sell', o.side === 'buy' ? 'up' : 'down');
      td(tr, priceOf(o), 'r num');
      td(tr, units(o.amount, o.market.base) + ' ' + tk(o.market.base), 'r num');
      const f = td(tr, '');
      const pct = Number(BigInt(o.filled || 0) * 100n / (BigInt(o.amount || 0) || 1n));
      const bar = el('span', 't-prog'); const i = el('i'); i.style.width = pct + '%'; bar.appendChild(i);
      f.appendChild(bar); f.appendChild(el('span', 'num', o.state === 'placing' ? 'Being placed' : pct + '%'));
      td(tr, o.can_take_back ? 'now' : o.take_back_from_text ? 'from ' + o.take_back_from_text : '', 'faint wide');
      const act = td(tr, '', 'r');
      if (o.can_take_back) {
        const b = el('button', 't-btn', 'Take back'); b.type = 'button';
        b.onclick = async () => {
          b.disabled = true; b.textContent = 'Waiting for your approval in the wallet…';
          try { await P.request('cancelOrder', { order: o.order }); opts.onChange && opts.onChange(); }
          catch (e) { b.disabled = false; b.textContent = 'Take back'; act.appendChild(el('div', 'status err', e.message)); }
        };
        act.appendChild(b);
      } else if (o.state !== 'filling') act.appendChild(el('span', 'faint', 'Stays on the book'));
      body.appendChild(tr);
    }
    return r;
  }

  if (opts.tab === 'trades') {
    const rows = [];
    for (const t of r.trades.filter(inMarket)) {
      const fills = t.fills && t.fills.length ? t.fills : [{ base: t.base || '0', quote: t.quote || '0', state: t.state }];
      for (const f of fills) {
        const buy = t.side === 'buy';
        rows.push({ at: t.at, pay: buy ? [f.quote, t.market.quote] : [f.base, t.market.base], get: buy ? [f.base, t.market.base] : [f.quote, t.market.quote], state: f.state || t.state, v: usdFor(t.market.quote, f.quote) });
      }
    }
    if (!rows.length) { say('No trades yet.'); return r; }
    const body = table([['Time', 'wide'], ['Trade'], ['Paid', 'r'], ['Got', 'r'], ['Value', 'r wide'], ['Status']]);
    for (const x of rows.sort((a, b) => b.at - a.at)) {
      const tr = el('tr');
      td(tr, when(x.at), 'num faint wide');
      td(tr, 'Swapped ' + units(x.pay[0], x.pay[1]) + ' ' + tk(x.pay[1]) + ' for ' + units(x.get[0], x.get[1]) + ' ' + tk(x.get[1]));
      td(tr, '-' + units(x.pay[0], x.pay[1]) + ' ' + tk(x.pay[1]), 'r num down');
      td(tr, '+' + units(x.get[0], x.get[1]) + ' ' + tk(x.get[1]), 'r num up');
      td(tr, x.v != null ? '$' + fmtUsd(x.v, 2) : '', 'r num faint wide');
      const s = td(tr, ''); s.appendChild(el('span', 't-st ' + x.state, STATE_WORDS[x.state] || 'Sent'));
      body.appendChild(tr);
    }
    return r;
  }

  const done = r.orders.filter((o) => (o.state === 'filled' || o.state === 'withdrawn') && inMarket(o)).sort((a, b) => b.at - a.at);
  if (!done.length) { say('No orders filled or taken back yet.'); return r; }
  const body = table([['Placed', 'wide'], ['Market'], ['Side'], ['Price', 'r'], ['Amount', 'r'], ['Filled', 'r'], ['Status']]);
  for (const o of done) {
    const tr = el('tr');
    td(tr, when(o.at), 'num faint wide');
    td(tr, name(o.market));
    td(tr, o.side === 'buy' ? 'Buy' : 'Sell', o.side === 'buy' ? 'up' : 'down');
    td(tr, priceOf(o), 'r num');
    td(tr, units(o.amount, o.market.base) + ' ' + tk(o.market.base), 'r num');
    td(tr, units(o.filled, o.market.base), 'r num');
    const st = o.state === 'filled' ? (o.settled ? 'settled' : 'sent') : 'returned';
    const s = td(tr, ''); s.appendChild(el('span', 't-st ' + st, o.state === 'withdrawn' ? 'Taken back' : STATE_WORDS[st]));
    body.appendChild(tr);
  }
  return r;
}
