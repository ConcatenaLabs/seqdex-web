// Shared page chrome: topbar injection, wallet connect button, helpers.
import * as P from './provider.js';
import { loadMeta } from './meta.js';

export const $ = (id) => document.getElementById(id);
export const el = (t, c, txt) => {
  const e = document.createElement(t);
  if (c) e.className = c;
  if (txt != null) e.textContent = txt;
  return e;
};

// The developer view's pages: one room per way of settling, and the leaves room. The
// default view (index.html, the markets) names none of them; they are linked only while
// the view is the developer one.
const PAGES = [
  ['index.html', 'Markets', 'market'],
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
  bar.appendChild(nav);
  bar.appendChild(el('span', 'spacer'));
  // The developer view's links are drawn only in the developer view; the default view
  // has no navigation beyond the wordmark, which leads to the markets.
  const showDev = (mode) => {
    const dev = developerView(mode);
    if (dev) { for (const a of links) if (!a.isConnected) nav.appendChild(a); }
    else for (const a of links) a.remove();
    if (mode === 'developer') { if (!devLink.isConnected) nav.appendChild(devLink); }
    else devLink.remove();
  };
  showDev(null);

  const btn = el('button', 'connect-btn');
  btn.id = 'btnConnect';
  bar.appendChild(btn);
  renderConnect(btn, null, P.hasWallet());

  P.onAccountChange((acc) => renderConnect(btn, acc, P.hasWallet()));
  btn.onclick = async () => {
    if (!P.hasWallet()) {
      window.open('https://sequentiatestnet.com/download/', '_blank', 'noopener');
      return;
    }
    if (P.account()) return;
    btn.disabled = true;
    try { await P.connect(); clearWarning(); }
    catch (e) { showWarning(bar, 'Could not connect: ' + e.message); }
    finally { btn.disabled = false; }
  };

  // No provider means no trading at all; say so plainly, with the way out.
  let note = null;
  if (!P.hasWallet()) {
    note = el('div', 'extnote');
    note.appendChild(el('b', null, 'SeqDEX needs the Sequentia wallet extension. '));
    note.appendChild(document.createTextNode('Every order and every settlement is signed inside the extension; this site never holds keys or funds. Get the extension from the '));
    const dl = el('a', null, 'downloads page');
    dl.href = 'https://sequentiatestnet.com/download/'; dl.target = '_blank'; dl.rel = 'noopener';
    note.appendChild(dl);
    note.appendChild(document.createTextNode(', install it in a Chromium browser (Chrome, Brave, Edge), then reload this page.'));
    bar.parentNode.insertBefore(note, bar.nextSibling);
  }

  // Everything that needs the provider object runs through onProvider, which
  // fires now if the extension is already injected and otherwise on its
  // sequentia#initialized event. A provider that lands after init is wired
  // the same way as one that was there from the start: the install note
  // goes, the button flips to "Connect wallet", events are watched, and a
  // silent restore picks up an existing session.
  let restored = Promise.resolve(null);
  P.onProvider(() => {
    if (note) { note.remove(); note = null; }
    renderConnect(btn, P.account(), true);
    P.watchEvents();
    restored = P.restore();
    P.walletMode().then(showDev).catch(() => {});
    P.onEvent('modeChanged', (d) => showDev(d && d.mode));
  });

  // When the provider is already there, onProvider has fired synchronously and
  // the restore is awaited so a page can render its connected state on first
  // paint; a late provider's restore reaches the pages through onAccountChange.
  await Promise.allSettled([loadMeta(), restored]);
  return P.account();
}

// One notice under the topbar for a failed connect: a user's rejection, a
// locked wallet, or a provider that did not identify itself as the Sequentia
// extension. Replaced on the next attempt, removed on success.
function showWarning(bar, text) {
  clearWarning();
  const w = el('div', 'extnote warn', text);
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
  if (!walletPresent) {
    btn.appendChild(document.createTextNode('Install the wallet'));
    btn.title = 'SeqDEX needs the Sequentia browser extension wallet';
    return;
  }
  if (acc) {
    btn.appendChild(document.createTextNode('Connected'));
    const a = el('span', 'addr', acc.address.slice(0, 10) + '…' + acc.address.slice(-4));
    btn.appendChild(a);
    btn.title = acc.address;
  } else {
    btn.appendChild(document.createTextNode('Connect wallet'));
    btn.title = 'Connect the Sequentia extension wallet';
  }
}

export function footer() {
  const f = el('div', 'foot');
  const mk = (href, txt) => { const a = el('a', null, txt); a.href = href; a.target = '_blank'; a.rel = 'noopener'; return a; };
  f.appendChild(el('span', null, 'SeqDEX · non-custodial · Sequentia testnet'));
  f.appendChild(mk('https://sequentiatestnet.com/', 'Explorer'));
  f.appendChild(mk('https://sequentiatestnet.com/download/', 'Wallet downloads'));
  f.appendChild(mk('https://github.com/ConcatenaLabs/seqdex-web', 'Source'));
  document.querySelector('.wrap').appendChild(f);
}
