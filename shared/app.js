// Shared page chrome: topbar injection, wallet connect button, helpers.
import * as P from './provider.js';
import { loadMeta } from './meta.js';
import { CHART_NOTICE } from './chart.js';

export const $ = (id) => document.getElementById(id);
const DOWNLOADS = 'https://sequentiatestnet.com/download/';
const LOCAL_HELP = 'https://github.com/ConcatenaLabs/sequentia-connect#readme';
// What a chooser row says of a wallet that is not there (the web wallet's docs/DEFAULT_MODE.md,
// "Connect").
const NOT_THERE_WORD = { extension: 'Not installed', local: 'Not running', webwallet: 'Not open', phone: 'Pair' };
export const el = (t, c, txt) => {
  const e = document.createElement(t);
  if (c) e.className = c;
  if (txt != null) e.textContent = txt;
  return e;
};

// Every view's pages: the markets (index.html, and a pair's market.html) and the
// portfolio. A pair's page counts as Markets.
const MAIN = [
  ['index.html', 'Markets', 'market', ['market.html']],
  ['portfolio.html', 'Portfolio', 'market', []],
];
// The developer view's pages: one room per way of settling, and the leaves room. The
// default view names none of them; they are linked only while the view is the
// developer one.
const PAGES = [
  ['rooms.html', 'Rooms', 'chain'],
  ['lndex.html', 'LNDEX', 'ln'],
  ['onchain.html', 'On-chain DEX', 'chain'],
  ['confidential.html', 'Confidential DEX', 'conf'],
  ['channels.html', 'Channels', 'ln'],
];

// The view follows the wallet's mode ('developer' or 'user'; no wallet reads as user),
// unless the site's own override says otherwise: `?view=developer` or `?view=default`
// on any page sets it for this browser, `?view=wallet` clears it.
const VIEW_KEY = 'seqdex.view';
function viewOverride() {
  let v = null;
  try {
    const q = new URLSearchParams(location.search).get('view');
    if (q === 'developer' || q === 'default') localStorage.setItem(VIEW_KEY, q);
    else if (q === 'wallet') localStorage.removeItem(VIEW_KEY);
    v = localStorage.getItem(VIEW_KEY);
  } catch { /* no storage: follow the wallet */ }
  return v === 'developer' || v === 'default' ? v : null;
}
export function developerView(mode) {
  const o = viewOverride();
  return o ? o === 'developer' : mode === 'developer';
}

export async function initChrome(active) {
  const bar = document.querySelector('.topbar');
  const here = location.pathname.split('/').pop() || 'index.html';

  const mark = el('a', 'wordmark');
  mark.href = 'index.html';
  const d = el('span', 'dot'); mark.appendChild(d);
  mark.appendChild(document.createTextNode('SeqDEX'));
  const t = el('small', null, 'testnet'); mark.appendChild(t);
  bar.appendChild(mark);

  const bo = el('a', 'builton');
  bo.href = 'https://sequentia.io'; bo.target = '_blank'; bo.rel = 'noopener';
  bo.title = 'SeqDEX runs on the Sequentia network';
  bo.appendChild(el('span', null, 'on'));
  const li = document.createElement('img');
  li.src = 'shared/sequentia-logo.svg'; li.alt = 'Sequentia'; li.className = 'sqlogo';
  bo.appendChild(li);
  bar.appendChild(bo);

  const nav = el('nav', 'nav');
  nav.id = 'devNav';
  for (const [href, label, s] of MAIN) {
    const a = el('a', null, label);
    a.href = href; a.dataset.s = s; a.dataset.main = href;
    nav.appendChild(a);
  }
  const links = [];
  for (const [href, label, s] of PAGES) {
    const a = el('a', null, label);
    a.href = href;
    a.dataset.s = s;
    if (href === here || href === active) a.classList.add('on');
    links.push(a);
  }
  // The leaves room is a developer-mode room: its link is drawn only while the wallet
  // says it is in developer mode, and goes when it says otherwise.
  const devLink = el('a', null, 'Leaves');
  devLink.href = 'leaves.html'; devLink.dataset.s = 'leaf'; devLink.id = 'navLeaves';
  if (here === 'leaves.html' || active === 'leaves.html') devLink.classList.add('on');
  // So is the pools room: the makers' pools and the clearing rounds.
  const poolLink = el('a', null, 'Pools');
  poolLink.href = 'pools.html'; poolLink.dataset.s = 'chain'; poolLink.id = 'navPools';
  if (here === 'pools.html' || active === 'pools.html') poolLink.classList.add('on');
  bar.appendChild(nav);
  markNav(active || here);
  bar.appendChild(el('span', 'spacer'));
  // The developer view's links are drawn only in the developer view; the default view
  // has no navigation beyond the wordmark, which leads to the markets.
  const showDev = (mode) => {
    const dev = developerView(mode);
    if (dev) { for (const a of links) if (!a.isConnected) nav.appendChild(a); }
    else for (const a of links) a.remove();
    if (mode === 'developer') {
      if (!devLink.isConnected) nav.appendChild(devLink);
      if (!poolLink.isConnected) nav.appendChild(poolLink);
    } else { devLink.remove(); poolLink.remove(); }
  };
  showDev(null);

  const btn = el('button', 'connect-btn');
  btn.id = 'btnConnect';
  btn.type = 'button';
  bar.appendChild(btn);
  renderConnect(btn, null, P.hasWallet());

  // The chooser: every wallet this site connects to, each with whether it is there.
  const menu = el('div', 'connect-menu');
  menu.id = 'connectMenu';
  menu.hidden = true;
  bar.appendChild(menu);
  const drawMenu = async () => {
    menu.textContent = '';
    menu.appendChild(el('p', 'faint', 'Connect with'));
    for (const c of P.connectors()) {
      const there = await c.available().catch(() => false);
      const row = el('button', 'connect-opt' + (P.activeConnector() === c && P.account() ? ' on' : ''));
      row.type = 'button';
      row.dataset.connector = c.id;
      row.appendChild(el('b', null, c.label));
      row.appendChild(el('span', 'faint', there ? (P.activeConnector() === c && P.account() ? 'Connected' : (c.id === 'phone' ? 'Paired' : 'Ready')) : NOT_THERE_WORD[c.id]));
      row.onclick = async () => {
        if (!there && c.id === 'webwallet') {
          // Opened beside this page; connected once it answers (its owner unlocks it there).
          c.open();
          menu.hidden = true;
          showWarning(bar, 'Open your web wallet in the new tab, then choose it here again.', 'info');
          const t0 = Date.now();
          while (Date.now() - t0 < 120000 && !(await c.available().catch(() => false))) await new Promise((r) => setTimeout(r, 1500));
          if (!c.present()) return;
          clearWarning();
        } else if (!there && c.id === 'phone') {
          menu.hidden = true;
          if (!(await pairPhone(c))) return;
        } else if (!there) {
          window.open(c.id === 'local' ? LOCAL_HELP : DOWNLOADS, '_blank', 'noopener');
          return;
        }
        menu.hidden = true;
        btn.disabled = true;
        try { if (P.activeConnector() !== c) await P.choose(c.id); await P.connect(); clearWarning(); }
        catch (e) { showWarning(bar, 'Could not connect: ' + e.message); }
        finally { btn.disabled = false; }
      };
      // A paired phone can be forgotten from here.
      if (c.id === 'phone' && there) {
        const f = el('a', 'faint forget', 'Forget'); f.href = '#'; f.id = 'phoneForget';
        f.onclick = (e) => { e.preventDefault(); e.stopPropagation(); c.forget(); menu.hidden = true; if (P.activeConnector() === c) P.choose(c.id); };
        row.appendChild(f);
      }
      menu.appendChild(row);
    }
    // Connected: Disconnect forgets the wallet here and in every other tab.
    if (P.account()) {
      const d = el('button', 'connect-opt'); d.type = 'button'; d.id = 'btnDisconnect';
      d.appendChild(el('b', null, 'Disconnect'));
      d.appendChild(el('span', 'faint', P.activeConnector().label));
      d.onclick = () => { menu.hidden = true; P.disconnect(); };
      menu.appendChild(d);
    }
  };

  P.onAccountChange((acc) => renderConnect(btn, acc, P.hasWallet()));
  P.onPresence(() => renderConnect(btn, P.account(), P.hasWallet()));
  btn.onclick = async () => {
    if (!menu.hidden) { menu.hidden = true; return; }
    await drawMenu();
    menu.hidden = false;
  };
  document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target) && e.target !== btn && !btn.contains(e.target)) menu.hidden = true; });

  // No wallet means no trading at all; say so plainly, with the ways in.
  let note = null;
  const drawNote = () => {
    if (P.hasWallet()) { if (note) { note.remove(); note = null; } return; }
    if (note) return;
    note = el('div', 'extnote');
    note.appendChild(el('b', null, 'SeqDEX needs a wallet. '));
    note.appendChild(document.createTextNode('Every order and every settlement is signed inside your wallet; this site never holds keys or funds. Use the '));
    const ww = el('a', null, 'Sequentia web wallet');
    ww.href = '/wallet/'; ww.target = 'sequentia-web-wallet';
    note.appendChild(ww);
    note.appendChild(document.createTextNode(', Ambra mobile (Connect wallet, then pair it), Ambra browser (from the '));
    const dl = el('a', null, 'downloads page');
    dl.href = DOWNLOADS; dl.target = '_blank'; dl.rel = 'noopener';
    note.appendChild(dl);
    note.appendChild(document.createTextNode(', in a Chromium browser), or your own Sequentia Core through '));
    const lc = el('a', null, 'sequentia-connect');
    lc.href = LOCAL_HELP; lc.target = '_blank'; lc.rel = 'noopener';
    note.appendChild(lc);
    note.appendChild(document.createTextNode(', then reload this page.'));
    bar.parentNode.insertBefore(note, bar.nextSibling);
  };
  drawNote();
  P.onPresence(drawNote);

  // Everything that needs the provider object runs through onProvider, which
  // fires now if the extension is already injected and otherwise on its
  // sequentia#initialized event. A provider that lands after init is wired
  // the same way as one that was there from the start: the install note
  // goes, the button flips to "Connect wallet", events are watched, and a
  // silent restore picks up an existing session.
  let restored = Promise.resolve(null);
  const wire = () => {
    drawNote();
    renderConnect(btn, P.account(), true);
    P.watchEvents();
    restored = P.restore();
    P.walletMode().then(showDev).catch(() => {});
    P.onEvent('modeChanged', (d) => showDev(d && d.mode));
  };
  P.onProvider(wire);
  // Another wallet chosen: its session, its mode and its events, the same way.
  P.onChoose(() => P.onProvider(wire));
  // The daemon on this computer is looked for once at load; wait for that look, so a
  // page whose wallet is the daemon renders its connected state on first paint.
  await Promise.all([P.localReady, P.webWalletReady]);

  // When the provider is already there, onProvider has fired synchronously and
  // the restore is awaited so a page can render its connected state on first
  // paint; a late provider's restore reaches the pages through onAccountChange.
  await Promise.allSettled([loadMeta(), restored]);
  return P.account();
}

// Marks the main navigation's link for a page (a pair's page counts as Markets).
export function markNav(page) {
  for (const a of document.querySelectorAll('#devNav a[data-main]')) {
    const m = MAIN.find((x) => x[0] === a.dataset.main);
    a.classList.toggle('on', !!m && (m[0] === page || m[3].includes(page)));
  }
}

// Pairing a wallet on a phone: a QR code to scan, and the same as a link for a wallet app on
// this phone. Resolves true once the wallet answered (its owner approved the pairing there).
async function pairPhone(c) {
  const box = el('div', 'pair-modal'); box.id = 'pairModal';
  const card = el('div', 'pair-card');
  card.appendChild(el('h2', null, 'Pair Ambra mobile'));
  card.appendChild(el('p', 'sub', 'Scan this code with Ambra mobile (Settings, Connect to a site), or open the link on the phone Ambra mobile is on. Ambra mobile shows this site and asks you to approve.'));
  const qr = el('div', 'pair-qr'); qr.id = 'pairQr';
  card.appendChild(qr);
  const link = el('a', 'pair-link', 'Open in Ambra mobile on this phone'); link.id = 'pairLink';
  card.appendChild(link);
  const st = el('p', 'status'); st.id = 'pairStatus'; st.textContent = 'Waiting for your wallet…';
  card.appendChild(st);
  const cancel = el('button', 'btn ghost small', 'Cancel'); cancel.type = 'button';
  card.appendChild(cancel);
  box.appendChild(card);
  document.body.appendChild(box);
  try {
    const { uri, paired } = await c.pair();
    link.href = uri;
    box.dataset.uri = uri;
    const { default: qrcode } = await import('./vendor/qrcode.mjs');
    const q = qrcode(0, 'L'); q.addData(uri); q.make();
    qr.innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    const ok = await Promise.race([paired.then(() => true), new Promise((r) => { cancel.onclick = () => r(false); })]);
    if (!ok) c.forget();
    return ok;
  } catch (e) {
    st.className = 'status err'; st.textContent = 'Could not start the pairing: ' + e.message;
    await new Promise((r) => { cancel.onclick = r; });
    return false;
  } finally { box.remove(); }
}

// One notice under the topbar for a failed connect: a user's rejection, a
// locked wallet, or a provider that did not identify itself as the Sequentia
// extension. Replaced on the next attempt, removed on success.
function showWarning(bar, text, kind = 'warn') {
  clearWarning();
  const w = el('div', 'extnote ' + kind, text);
  w.id = 'connectWarning';
  w.setAttribute('role', 'alert');
  bar.parentNode.insertBefore(w, bar.nextSibling);
}
function clearWarning() {
  const w = document.getElementById('connectWarning');
  if (w) w.remove();
}

function renderConnect(btn, acc, walletPresent) {
  btn.textContent = '';
  const st = el('span', 'st'); btn.appendChild(st);
  btn.classList.toggle('ok', !!acc);
  if (acc) {
    btn.appendChild(document.createTextNode('Connected'));
    const a = el('span', 'addr', acc.address.slice(0, 10) + '…' + acc.address.slice(-4));
    btn.appendChild(a);
    btn.title = acc.address + ' · ' + P.activeConnector().label;
  } else {
    btn.appendChild(document.createTextNode(walletPresent ? 'Connect wallet' : 'Get a wallet'));
    btn.title = 'The Sequentia web wallet, Ambra mobile, Ambra browser, or Sequentia Core on this computer';
  }
}

// The footer; `chart` adds the chart library's notice and its link, which every page
// that draws a chart shows.
export function footer({ chart = false } = {}) {
  const f = el('div', 'foot');
  const mk = (href, txt) => { const a = el('a', null, txt); a.href = href; a.target = '_blank'; a.rel = 'noopener'; return a; };
  f.appendChild(el('span', null, 'SeqDEX · non-custodial · Sequentia testnet'));
  f.appendChild(mk('https://sequentiatestnet.com/', 'Explorer'));
  f.appendChild(mk('https://sequentiatestnet.com/download/', 'Wallet downloads'));
  f.appendChild(mk('https://github.com/ConcatenaLabs/seqdex-web', 'Source'));
  if (chart) f.appendChild(mk(CHART_NOTICE.href, CHART_NOTICE.text));
  document.querySelector('.wrap').appendChild(f);
}
