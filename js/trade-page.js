// Shared trading-page driver: markets list, order book, wallet panel.
// Each surface page instantiates it with its mount and its own rules.
import { $, el } from '../shared/app.js';
import { assetMeta, fmtAtoms, fmtPrice, assetSupervised, supervisionNote } from '../shared/meta.js';
import { markets, orderbook, priceOf, pureLnOnly, pureLnMarkets, unexpired } from '../shared/book.js';
import * as P from '../shared/provider.js';

export function pairLabel(m) {
  return assetMeta(m.base).ticker + ' / ' + (m.quote === 'BTC' ? 'BTC' : assetMeta(m.quote).ticker);
}

const MARKETS_POLL_MS = 60_000;
const BOOK_POLL_MS = 15_000;

// A status line is a live region: a fill's progress and its outcome are read
// out to assistive tech as they change, without moving focus.
function statusEl(id) {
  const st = el('div', 'status');
  if (id) st.id = id;
  st.setAttribute('role', 'status');
  st.setAttribute('aria-live', 'polite');
  return st;
}

export async function runTradePage({ mount, lnOnly = false, confOnly = false, wantChannels = false, fill = null }) {
  let mkts = [];
  let current = null;
  let bookTimer = null;
  let mktTimer = null;
  let ticketOffer = null;
  const sameMarket = (a, b) => !!a && !!b && a.base === b.base && a.quote === b.quote;
  const mktKey = (m) => m.base + '/' + m.quote;

  // Cross-chain (BTC-quoted) orders on the on-chain books: the wallet's
  // dexFillOnchain refuses them, so the site does not open a ticket for one.
  const crossChainUnfillable = () => fill !== 'ln' && !!current && current.quote === 'BTC';

  // ---- wallet job progress ----
  // The extension broadcasts dexProgress to every connected page, for every
  // job it runs. Only jobs this page started are painted, each into the
  // status line of the ticket that started it, and a job leaves the table the
  // moment its result is in, so a late tick can never overwrite a final
  // outcome or an error line. Another tab's "slice 2 of 3" is ignored here.
  const activeJobs = new Map(); // jobId -> status element
  P.onProvider(() => {
    P.onEvent('dexProgress', (d) => {
      if (!d || d.job == null || !d.text) return;
      const st = activeJobs.get(String(d.job));
      if (st) st.textContent = String(d.text);
    });
  });

  // ---- markets list ----
  // Two halves: fetchMarkets decides what belongs on this surface, and
  // renderMarkets updates the list in place so a 60 s poll never rebuilds
  // what has not changed and never drops the selection.
  async function fetchMarkets() {
    let list = await markets(mount);
    if (confOnly) {
      // The relay summarises the transparent and blinded books of a pair as
      // two markets, flagged on the pair; this surface shows only the blinded
      // ones (offers are filtered per-offer again in refreshBook). Bitcoin has
      // no confidential transactions, so a BTC leg cannot exist here and a
      // relay entry claiming one is dropped.
      list = list.filter((m) => m.confidential && m.base !== 'BTC' && m.quote !== 'BTC');
    }
    if (lnOnly) {
      // The relay's n_orders counts every offer family; the LNDEX list is
      // rebuilt from the books so it shows pure-LN counts and only markets
      // that have one.
      list = await pureLnMarkets(mount, list);
    }
    return list;
  }

  function marketButton(m) {
    const b = el('button', 'mkt');
    b.type = 'button';
    b.dataset.key = mktKey(m);
    b.appendChild(el('span', 'pair', pairLabel(m)));
    // A trader is about to ACQUIRE this asset, so say up front if its issuer
    // can freeze it. Settlement in flight is never caught: a freeze reaches
    // ordinary addresses, not channels, HTLCs or covenants.
    if (assetSupervised(m.base) || assetSupervised(m.quote)) {
      const sup = el('span', 'sup', '⊘');
      sup.title = supervisionNote(assetSupervised(m.base) ? m.base : m.quote);
      b.appendChild(sup);
    }
    if (m.quote === 'BTC') b.appendChild(el('span', 'sub2 cross', '· cross-chain'));
    b.appendChild(el('span', 'n', m.nOrders + ' ord'));
    b.onclick = () => select(m, b);
    return b;
  }

  function renderMarkets(list) {
    const box = $('mktList');
    // The selected market stays in the list even when the poll no longer
    // returns it (its last pure-LN offer expired, say): the book under it
    // shows the empty state and the user keeps their place instead of
    // watching the highlight vanish.
    if (current && !list.some((m) => sameMarket(m, current))) list = [...list, { ...current, nOrders: 0 }];
    const empty = box.querySelector('p.sub');
    if (!list.length) {
      box.textContent = '';
      box.appendChild(el('p', 'sub', confOnly
        ? 'No confidential markets yet. This book opens when the first blinded offer is posted.'
        : lnOnly ? 'No markets with pure-Lightning offers right now.' : 'No markets on this book right now.'));
      $('bookBody').textContent = '';
      return;
    }
    if (empty) empty.remove();
    const have = new Map();
    for (const b of box.querySelectorAll('button.mkt')) have.set(b.dataset.key, b);
    let cursor = null;
    for (const m of list) {
      let b = have.get(mktKey(m));
      if (b) {
        have.delete(mktKey(m));
        const n = b.querySelector('.n');
        const txt = m.nOrders + ' ord';
        if (n.textContent !== txt) n.textContent = txt;
        b.onclick = () => select(m, b);
      } else {
        b = marketButton(m);
      }
      // Keep document order equal to list order; appending an existing node
      // moves it, and a node already in place is left alone.
      const want = cursor ? cursor.nextSibling : box.firstChild;
      if (want !== b) box.insertBefore(b, want);
      cursor = b;
      const on = sameMarket(m, current);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (on) current = m;
    }
    for (const b of have.values()) b.remove();
    if (!current) select(list[0], box.querySelector('button.mkt'));
  }

  async function loadMarkets() {
    const box = $('mktList');
    try {
      mkts = await fetchMarkets();
      renderMarkets(mkts);
    } catch (e) {
      // A failed poll leaves a list that is already showing alone; only a
      // first load with nothing to show says the book is unreachable.
      if (!box.querySelector('button.mkt')) {
        box.textContent = '';
        box.appendChild(el('p', 'sub', 'Book unreachable: ' + e.message));
      }
    }
  }

  async function select(m, btn) {
    current = m;
    ticketOffer = null;
    const tp = $('ticketPanel');
    if (tp) { tp.classList.add('hide'); tp.textContent = ''; }
    for (const x of document.querySelectorAll('.mkt')) { x.classList.remove('on'); x.setAttribute('aria-pressed', 'false'); }
    if (btn) { btn.classList.add('on'); btn.setAttribute('aria-pressed', 'true'); }
    $('bookTitle').textContent = pairLabel(m);
    await refreshBook();
    renderWallet();
    renderMarketTicket();
  }

  async function refreshBook() {
    if (!current) return;
    const body = $('bookBody');
    // The market can change while the fetch is in flight (a click during the
    // 15 s poll); a reply for the old market must not paint under the new title.
    const m = current;
    try {
      let offers = await orderbook(mount, m.base, m.quote);
      if (current !== m && !sameMarket(current, m)) return;
      if (lnOnly) offers = pureLnOnly(offers);
      if (confOnly) offers = offers.filter((o) => o.confidential);
      offers = unexpired(offers);
      const bPrec = assetMeta(current.base).precision ?? 8;
      const qPrec = current.quote === 'BTC' ? 8 : (assetMeta(current.quote).precision ?? 8);
      const asks = offers.filter((o) => o.side === 'ask').sort((a, b) => priceOf(a, bPrec, qPrec) - priceOf(b, bPrec, qPrec));
      const bids = offers.filter((o) => o.side === 'bid').sort((a, b) => priceOf(b, bPrec, qPrec) - priceOf(a, bPrec, qPrec));
      body.textContent = '';
      const bTicker = assetMeta(current.base).ticker;
      const qTicker = current.quote === 'BTC' ? 'BTC' : assetMeta(current.quote).ticker;
      const row = (o, cls) => {
        const tr = el('tr');
        const p = priceOf(o, bPrec, qPrec);
        tr.appendChild(el('td', cls, fmtPrice(p)));
        tr.appendChild(el('td', null, fmtAtoms(o.baseAtoms, bPrec)));
        tr.appendChild(el('td', null, fmtAtoms(o.quoteAtoms, qPrec)));
        tr.appendChild(el('td', 'faint', o.expiresAt ? rel(o.expiresAt) : '·'));
        if (fill) {
          // A fillable row is a real control: focusable, announced as a
          // button, and operable with Enter or Space as well as a click.
          tr.classList.add('fill');
          tr.tabIndex = 0;
          tr.setAttribute('role', 'button');
          tr.setAttribute('aria-label', (cls === 'ask' ? 'Buy ' : 'Sell ') + bTicker + ' at ' + fmtPrice(p) + ' ' + qTicker +
            ', size ' + fmtAtoms(o.baseAtoms, bPrec) + ' ' + bTicker);
          tr.title = crossChainUnfillable() ? 'Cross-chain fills arrive next.'
            : o.covenant ? 'Fill this covenant order (maker can be offline; chain-enforced)' : 'Fill this order';
          tr.onclick = () => openTicket(o);
          tr.onkeydown = (ev) => {
            if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openTicket(o); }
          };
        }
        return tr;
      };
      // asks render top-down from worst to best so the spread sits in the middle
      for (const o of [...asks].reverse()) body.appendChild(row(o, 'ask'));
      const spread = el('tr', 'spread');
      const td = el('td', null, spreadLabel(asks, bids, bPrec, qPrec, qTicker));
      td.colSpan = 4; spread.appendChild(td); body.appendChild(spread);
      for (const o of bids) body.appendChild(row(o, 'bid'));
      if (!asks.length && !bids.length) {
        const tr = el('tr'); const t = el('td', 'sub', lnOnly ? 'No pure-Lightning offers on this market right now.' : 'No offers on this market right now.');
        t.colSpan = 4; tr.appendChild(t); body.textContent = ''; body.appendChild(tr);
      }
    } catch (e) {
      if (current !== m && !sameMarket(current, m)) return;
      body.textContent = '';
      const tr = el('tr'); const t = el('td', 'sub', 'Order book unavailable: ' + e.message);
      t.colSpan = 4; tr.appendChild(t); body.appendChild(tr);
    }
  }

  // Polls a wallet job until it is done. A poll that fails (the extension
  // reloaded, the wallet locked, the port restarted) used to read as "not done
  // yet" for the whole deadline; after a few failures in a row the last error is
  // surfaced instead. onTick sees every successful reply. While the job runs,
  // dexProgress ticks for it paint into `status`; once it returns, they stop.
  async function waitForJob(jobId, deadlineMs, { status = null, onTick = null } = {}) {
    const key = String(jobId);
    if (status) activeJobs.set(key, status);
    try {
      const deadline = Date.now() + deadlineMs;
      let failures = 0, lastErr = null;
      for (;;) {
        await new Promise((r) => setTimeout(r, 4000));
        let jr;
        try { jr = await P.request('dexJobResult', { jobId }); failures = 0; }
        catch (e) { lastErr = e; if (++failures >= 3) throw new Error('lost contact with the wallet: ' + e.message); continue; }
        if (onTick) onTick(jr);
        if (jr.done) return jr;
        if (Date.now() > deadline) throw new Error('the order is taking unusually long; check your balances' + (lastErr ? ' (' + lastErr.message + ')' : ''));
      }
    } finally {
      activeJobs.delete(key);
    }
  }

  // Parses a decimal typed by the user into atoms at the given precision.
  // Digits and one point only: Number() would accept hex, exponents and signs,
  // and a float product rounds by up to an atom in whichever direction the
  // binary fraction falls, which on a limit price means placing above the typed
  // limit. Prices and amounts both go through here.
  function parseDecimalAtoms(str, prec, what) {
    str = (str || '').trim();
    if (!/^\d+(\.\d+)?$/.test(str)) throw new Error('enter a valid ' + what);
    const [i, f = ''] = str.split('.');
    if (f.length > prec) throw new Error(what + ': max ' + prec + ' decimals');
    return BigInt(i) * 10n ** BigInt(prec) + BigInt((f + '0'.repeat(prec)).slice(0, prec) || '0');
  }

  function spreadLabel(asks, bids, bPrec, qPrec, qTicker) {
    const a = asks[0] ? priceOf(asks[0], bPrec, qPrec) : null;
    const b = bids[0] ? priceOf(bids[0], bPrec, qPrec) : null;
    if (a == null && b == null) return '·';
    if (a != null && b != null) return 'spread ' + fmtPrice(a - b) + ' ' + qTicker;
    return a != null ? 'asks only' : 'bids only';
  }

  function rel(unix) {
    const s = unix - Math.floor(Date.now() / 1000);
    if (s <= 0) return 'expired';
    if (s < 90) return s + 's';
    if (s < 5400) return Math.round(s / 60) + 'm';
    return Math.round(s / 3600) + 'h';
  }

  // A decimal amount field: labelled by id, numeric keypad on touch devices.
  function amountInput(id) {
    const inp = el('input', 'mono');
    inp.id = id;
    inp.type = 'text';
    inp.inputMode = 'decimal';
    inp.autocomplete = 'off';
    inp.spellcheck = false;
    return inp;
  }

  // ---- wallet panel ----
  // balances is null until the first successful read; walletErr carries the
  // reason the last read failed (a locked wallet answers getBalances with an
  // error, and "Loading…" forever is not an answer); walletBusy is the read
  // in flight.
  let balances = null, channels = null, walletErr = null, walletBusy = false;
  async function loadWallet() {
    if (!P.account()) { balances = null; channels = null; walletErr = null; renderWallet(); return; }
    walletBusy = true;
    renderWallet();
    try { balances = await P.getBalances(); walletErr = null; }
    catch (e) { balances = null; walletErr = (e && e.message) ? e.message : String(e); }
    if (wantChannels) { try { channels = await P.lnChannels(); } catch { channels = null; } }
    walletBusy = false;
    renderWallet();
  }

  function renderWallet() {
    const box = $('walletPanel');
    box.textContent = '';
    if (!P.account()) {
      box.appendChild(el('p', 'sub', P.hasWallet()
        ? 'Connect the wallet to see your balances here.'
        : P.NO_WALLET));
      return;
    }
    if (walletErr && !balances) {
      const p = el('p', 'sub', 'Wallet locked or unreachable: ' + walletErr + '. ');
      const retry = el('button', 'btn ghost small', walletBusy ? 'Retrying…' : 'Retry');
      retry.type = 'button';
      retry.disabled = walletBusy;
      retry.onclick = async () => {
        // A locked wallet is the usual reason; connect doubles as unlock and
        // prompts only when it has to. Its account-change emit is what
        // triggers the reload.
        try { await P.connect(); } catch (e) { walletErr = e.message; renderWallet(); }
      };
      p.appendChild(retry);
      box.appendChild(p);
      return;
    }
    if (!current || !balances) { box.appendChild(el('p', 'sub', 'Loading…')); return; }
    const sides = [
      { hex: current.base, label: 'base' },
      { hex: current.quote, label: 'quote' },
    ];
    for (const s of sides) {
      const meta = assetMeta(s.hex);
      const atoms = s.hex === 'BTC' ? (balances.btc || '0') : (balances.assets[s.hex] || '0');
      const r = el('div', 'wrow');
      const tk = el('span', 'tk', meta.ticker);
      tk.title = assetSupervised(s.hex) ? (meta.name + '. ' + supervisionNote(s.hex)) : meta.name;
      r.appendChild(tk);
      if (assetSupervised(s.hex)) {
        const sup = el('span', 'sup', '⊘'); sup.title = supervisionNote(s.hex); r.appendChild(sup);
      }
      r.appendChild(el('span', 'sub2', 'on-chain'));
      r.appendChild(el('span', 'amt', fmtAtoms(atoms, meta.precision ?? 8)));
      box.appendChild(r);
      if (wantChannels) {
        const ch = (channels && channels.channels || []).filter((c) => c.kind === s.hex);
        const spend = ch.reduce((t, c) => t + BigInt(c.spendable || 0), 0n);
        const recv = ch.some((c) => c.receivable == null) ? null : ch.reduce((t, c) => t + BigInt(c.receivable || 0), 0n);
        const r2 = el('div', 'wrow');
        r2.appendChild(el('span', 'tk', '⚡'));
        r2.appendChild(el('span', 'sub2', ch.length ? (ch.length + ' channel' + (ch.length > 1 ? 's' : '')) : 'no channel'));
        r2.appendChild(el('span', 'amt', ch.length ? (fmtAtoms(spend, meta.precision ?? 8) + (recv != null ? ' / ' + fmtAtoms(recv, meta.precision ?? 8) : '')) : '·'));
        box.appendChild(r2);
      }
    }
    if (wantChannels) {
      const hint = el('p', 'sub');
      hint.style.marginTop = '10px';
      const missing = sides.filter((s) => !((channels && channels.channels || []).some((c) => c.kind === s.hex)));
      if (channels && !channels.deployed) {
        hint.textContent = 'Lightning is not reachable from the wallet right now.';
      } else if (missing.length) {
        hint.appendChild(document.createTextNode('Trading here needs Lightning channels on both legs. Missing: ' + missing.map((s) => assetMeta(s.hex).ticker).join(', ') + '. '));
        const a = el('a', null, 'Get inbound liquidity'); a.href = 'channels.html'; hint.appendChild(a);
        hint.appendChild(document.createTextNode('.'));
      } else {
        hint.textContent = 'Channel capacity is shown as spendable / receivable.';
      }
      box.appendChild(hint);
    }
  }

  // ---- fill ticket ----
  const big = (v) => BigInt(v ?? 0);
  const ceilDiv = (a, b) => (a + b - 1n) / b;

  function parseBaseAmt(str, prec) { return parseDecimalAtoms(str, prec, 'amount'); }

  // Preview mirror of the wallet's math (the wallet recomputes from the relay
  // and its numbers are the ones on the approval sheet). A partial take is
  // clamped to the offer's min_fill, which the relay enforces on the lift.
  function previewFill(o, takeBase) {
    let take = takeBase;
    if (take < 1n) take = 1n;
    if (o.minFill > 0n && take < o.minFill) take = o.minFill;
    if (take > o.baseAtoms) take = o.baseAtoms;
    // Same direction as the wallet's slice pricing (plnSliceQuote): floor when
    // you GIVE the quote (taking an ask), ceil when you RECEIVE it (taking a bid).
    const quote = o.side === 'ask' ? (o.quoteAtoms * take) / o.baseAtoms          // you pay quote
                                   : ceilDiv(o.quoteAtoms * take, o.baseAtoms);   // you receive quote
    return { take, quote, whole: take >= o.baseAtoms };
  }

  // Market ticket (LNDEX): side + amount only; the WALLET plans the walk from
  // the relay book and shows one aggregate approval. Users stop being obliged
  // to pick a single resting order by hand.
  function renderMarketTicket() {
    if (fill !== 'ln' || !current) return;
    const tp = $('ticketPanel');
    let box = document.getElementById('marketPanel');
    if (!box) {
      box = el('div', 'panel');
      box.id = 'marketPanel';
      tp.parentNode.insertBefore(box, tp);
    }
    box.textContent = '';
    const bm = assetMeta(current.base);
    const qm = current.quote === 'BTC' ? { ticker: 'BTC', precision: 8 } : assetMeta(current.quote);

    // Order type: two toggle buttons, the pressed one is the mode.
    let mode = 'market';
    const modes = el('div', 'modes');
    const h = el('h2', null, 'Market order');
    const seg = el('div', 'seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Order type');
    const bMarket = el('button', 'linkbtn', 'market'); bMarket.type = 'button';
    const bLimit = el('button', 'linkbtn', 'limit'); bLimit.type = 'button';
    seg.appendChild(bMarket); seg.appendChild(bLimit);
    modes.appendChild(h); modes.appendChild(seg); box.appendChild(modes);

    // Side: two toggle buttons, the pressed one is the side.
    let side = 'buy';
    const row = el('div', 'sides');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'Side');
    const bBuy = el('button', 'btn toggle', 'Buy ' + bm.ticker); bBuy.type = 'button';
    const bSell = el('button', 'btn toggle', 'Sell ' + bm.ticker); bSell.type = 'button';
    const paintSide = () => {
      bBuy.setAttribute('aria-pressed', side === 'buy' ? 'true' : 'false');
      bSell.setAttribute('aria-pressed', side === 'sell' ? 'true' : 'false');
    };
    bBuy.onclick = () => { side = 'buy'; paintSide(); };
    bSell.onclick = () => { side = 'sell'; paintSide(); };
    row.appendChild(bBuy); row.appendChild(bSell); box.appendChild(row); paintSide();

    const lbl = el('label', 'lbl');
    lbl.htmlFor = 'mktAmt';
    box.appendChild(lbl);
    const inp = amountInput('mktAmt'); box.appendChild(inp);
    const plbl = el('label', 'lbl', 'Limit price (' + qm.ticker + ' per ' + bm.ticker + ') · fills what crosses, rests the remainder');
    plbl.htmlFor = 'mktPrice';
    const pinp = amountInput('mktPrice');
    box.appendChild(plbl); box.appendChild(pinp);
    const go = el('button', 'btn', 'Place market order'); go.type = 'button'; go.style.marginTop = '10px';
    box.appendChild(go);
    const paintMode = () => {
      const limit = mode === 'limit';
      h.textContent = limit ? 'Limit order' : 'Market order';
      bMarket.setAttribute('aria-pressed', limit ? 'false' : 'true');
      bLimit.setAttribute('aria-pressed', limit ? 'true' : 'false');
      plbl.classList.toggle('hide', !limit);
      pinp.classList.toggle('hide', !limit);
      lbl.textContent = 'Amount (' + bm.ticker + ')' + (limit
        ? ' · your order rests until matched, served live by your wallet'
        : ' · walks the book across resting orders, one wallet approval');
      go.textContent = limit ? 'Place limit order' : 'Place market order';
    };
    bMarket.onclick = () => { mode = 'market'; paintMode(); };
    bLimit.onclick = () => { mode = 'limit'; paintMode(); };
    paintMode();
    const st = statusEl('marketStatus'); box.appendChild(st);
    go.onclick = async () => {
      st.className = 'status'; st.textContent = '';
      if (!P.account()) {
        try { await P.connect(); } catch (e) { st.className = 'status err'; st.textContent = e.message; return; }
      }
      let atoms;
      try { atoms = parseBaseAmt(inp.value, bm.precision); } catch (e) { st.className = 'status err'; st.textContent = e.message; return; }
      go.disabled = true;
      st.textContent = 'Waiting for wallet approval…';
      try {
        let res;
        let warning = '';
        if (mode === 'limit') {
          // The wallet binds to limitQuoteAtoms as the exact integer price for the
          // whole amount, so it is computed in integers: price scaled to the quote
          // precision, times the base atoms, over one base unit. A buy never pays
          // above the typed limit (floor); a sell never receives below it (ceil).
          const qprec = qm.precision ?? 8;
          const bprec = bm.precision ?? 8;
          const priceAtoms = parseDecimalAtoms(pinp.value, qprec, 'limit price');
          if (priceAtoms <= 0n) throw new Error('enter a limit price');
          const unit = 10n ** BigInt(bprec);
          const product = atoms * priceAtoms;
          const limitQuoteAtoms = side === 'buy' ? product / unit : ceilDiv(product, unit);
          if (limitQuoteAtoms <= 0n) throw new Error('price times amount rounds to zero');
          res = await P.request('dexPlaceLimit', { room: 'ln', base: current.base, quote: current.quote, side, baseAtoms: atoms.toString(), limitQuoteAtoms: limitQuoteAtoms.toString() });
        } else {
          res = await P.request('dexMarketOrder', { room: 'ln', base: current.base, quote: current.quote, side, baseAtoms: atoms.toString() });
        }
        if (res.jobId) {
          st.textContent = mode === 'limit' ? 'Order placed; your wallet is serving it…' : 'Market order running in your wallet…';
          const jr = await waitForJob(res.jobId, mode === 'limit' ? 12 * 60 * 60_000 : 20 * 60_000, { status: st, onTick: (tick) => {
            if (tick.resting) {
              st.className = 'status ok';
              st.textContent = 'Resting on the book (' + fmtAtoms(big(tick.remaining || '0'), bm.precision) + ' ' + bm.ticker +
                ' remaining' + (Number(tick.filledAtoms || 0) > 0 ? ', ' + fmtAtoms(big(tick.filledAtoms), bm.precision) + ' filled so far' : '') +
                '). Served live by your wallet; keep this browser open.';
              refreshBook();
            }
          } });
          if (!jr.ok) throw new Error(jr.error || 'no slice settled');
          // A limit order can fill its crossing slices and then fail to rest the
          // remainder; the wallet reports ok with an error attached. Say so.
          if (jr.error) warning = ' Note: ' + jr.error;
          res = jr.result;
        }
        const okSlices = (res.slices || []).filter((x) => x.ok).length + (res.fills || []).length;
        st.className = 'status ok';
        st.textContent = 'Filled ' + fmtAtoms(big(res.baseAtoms), bm.precision) + ' ' + bm.ticker +
          (side === 'buy' ? ' for ' : ' receiving ') + fmtAtoms(big(res.quoteAtoms), qm.precision) + ' ' + qm.ticker +
          ' across ' + okSlices + ' order' + (okSlices === 1 ? '' : 's') + ', all over Lightning.' + warning;
        refreshBook(); loadWallet();
      } catch (e) {
        st.className = 'status err';
        st.textContent = (mode === 'limit' ? 'Limit order failed: ' : 'Market order failed: ') + e.message;
      } finally { go.disabled = false; }
    };
  }

  function openTicket(o) {
    const box = $('ticketPanel');
    box.classList.remove('hide');
    box.textContent = '';
    if (crossChainUnfillable()) {
      ticketOffer = null;
      const p = statusEl();
      p.textContent = 'Cross-chain fills arrive next. This order is quoted in BTC and cannot be filled from the site yet.';
      box.appendChild(p);
      return;
    }
    ticketOffer = o;
    const bm = assetMeta(current.base);
    const qm = current.quote === 'BTC' ? { ticker: 'BTC', precision: 8 } : assetMeta(current.quote);
    const youBuy = o.side === 'ask';   // taking an ask = you buy base; taking a bid = you sell base
    box.appendChild(el('h2', null, (youBuy ? 'Buy ' : 'Sell ') + bm.ticker + (youBuy ? ' with ' : ' for ') + qm.ticker));
    const lbl = el('label', 'lbl', 'Amount (' + bm.ticker + ') · offer size ' + fmtAtoms(o.baseAtoms, bm.precision) +
      (o.partial && o.minFill > 0n ? ' · minimum ' + fmtAtoms(o.minFill, bm.precision) : ''));
    lbl.htmlFor = 'ticketAmt';
    box.appendChild(lbl);
    const inp = amountInput('ticketAmt');
    inp.value = fmtAtoms(o.baseAtoms, bm.precision);
    box.appendChild(inp);
    const prev = el('p', 'sub'); prev.id = 'ticketPreview'; prev.style.marginTop = '8px';
    box.appendChild(prev);
    const btn = el('button', 'btn', youBuy ? 'Buy ' + bm.ticker : 'Sell ' + bm.ticker);
    btn.id = 'ticketGo'; btn.type = 'button'; btn.style.marginTop = '12px';
    box.appendChild(btn);
    const st = statusEl('ticketStatus');
    box.appendChild(st);
    if (!o.partial) inp.disabled = true;
    // The ticket opened from a keyboard-activated row; move focus into it so
    // the next Tab lands on the amount, not back in the book.
    (o.partial ? inp : btn).focus();

    const repaint = () => {
      try {
        const take = o.partial ? parseBaseAmt(inp.value, bm.precision) : o.baseAtoms;
        const pv = previewFill(o, take);
        prev.textContent = (youBuy
          ? 'You pay ≈ ' + fmtAtoms(pv.quote, qm.precision) + ' ' + qm.ticker + ' and receive ' + fmtAtoms(pv.take, bm.precision) + ' ' + bm.ticker
          : 'You give ' + fmtAtoms(pv.take, bm.precision) + ' ' + bm.ticker + ' and receive ≈ ' + fmtAtoms(pv.quote, qm.precision) + ' ' + qm.ticker)
          + (pv.whole ? ' (the whole offer)' : ' (partial, at the offer’s exact ratio)')
          + '. Exact amounts are confirmed in the wallet approval.';
        btn.disabled = false;
        return pv;
      } catch (e) { prev.textContent = e.message; btn.disabled = true; return null; }
    };
    inp.addEventListener('input', repaint);
    repaint();

    btn.onclick = async () => {
      st.className = 'status'; st.textContent = '';
      if (!P.account()) {
        try { await P.connect(); } catch (e) { st.className = 'status err'; st.textContent = e.message; return; }
      }
      const pv = repaint();
      if (!pv) return;
      btn.disabled = true;
      st.textContent = 'Waiting for wallet approval…';
      try {
        let res;
        if (fill === 'ln') {
          res = await P.request('dexSwapLn', {
            base: current.base, quote: current.quote, offerId: o.id,
            takeAtoms: pv.whole ? undefined : pv.take.toString(),
          });
          if (res.jobId) {
            // The swap runs as a wallet job that survives anything; poll it.
            st.className = 'status';
            st.textContent = 'Swap running in your wallet…';
            const jr = await waitForJob(res.jobId, 12 * 60_000, { status: st });
            if (!jr.ok) throw new Error(jr.error || 'swap failed');
            res = jr.result;
          }
          st.className = 'status ok';
          st.textContent = 'Settled over Lightning: ' +
            (youBuy ? 'received ' + fmtAtoms(big(res.baseAtoms), bm.precision) + ' ' + bm.ticker
                    : 'received ' + fmtAtoms(big(res.quoteAtoms), qm.precision) + ' ' + qm.ticker) +
            '. Instant and final.';
        } else {
          res = await P.request('dexFillOnchain', {
            mount: fill === 'conf' ? 'conf' : 'chain',
            base: current.base, quote: current.quote, offerId: o.id,
            takeBase: pv.take.toString(),
          });
          st.className = 'status ok';
          st.textContent = 'Filled. Swap transaction ' + (res.txid ? res.txid.slice(0, 16) + '…' : 'broadcast') +
            '. Settles in about a block.';
        }
        refreshBook();
        loadWallet();
      } catch (e) {
        st.className = 'status err';
        st.textContent = 'Fill failed: ' + e.message;
      } finally {
        btn.disabled = false;
      }
    };
  }

  P.onAccountChange(() => loadWallet());
  await loadMarkets();
  await loadWallet();
  bookTimer = setInterval(() => { refreshBook(); }, BOOK_POLL_MS);
  mktTimer = setInterval(() => { loadMarkets(); }, MARKETS_POLL_MS);
  window.addEventListener('pagehide', () => { clearInterval(bookTimer); clearInterval(mktTimer); });
}
