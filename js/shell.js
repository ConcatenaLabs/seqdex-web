// SeqDEX's one page: the markets, a pair and the portfolio are views of it. The header with
// the wallet stays put and the wallet is connected once; moving between views (a link, a
// row of the Tickers panel, back and forward) changes the address with the History API and
// swaps the view, loading no page. index.html, market.html and portfolio.html each serve
// this same page, so every address opens directly, a reload included.
import { initChrome, footer, markNav } from '../shared/app.js';
import { start as startStore } from './store.js';
import { setFollow } from './nav.js';
import { lifecycle } from './life.js';
import { mountMarkets } from './markets-page.js';
import { mountPair } from './market-page.js';
import { mountPortfolio } from './portfolio-page.js';

const VIEWS = { 'index.html': mountMarkets, 'market.html': mountPair, 'portfolio.html': mountPortfolio };
const root = document.getElementById('view');
const base = location.pathname.replace(/[^/]*$/, '');      // the folder the site is served from
const pageOf = (u) => { const f = u.pathname.slice(base.length); return VIEWS[f] ? f : f === '' ? 'index.html' : null; };
let current = null;   // { page, life, view }

function show() {
  const u = new URL(location.href);
  // An old link to a pair on the markets page opens the pair's view.
  if (pageOf(u) === 'index.html' && u.searchParams.has('pair')) history.replaceState(null, '', base + 'market.html' + u.search);
  const page = pageOf(new URL(location.href)) || 'index.html';
  if (current && current.page === page) { if (current.view && current.view.onUrl) current.view.onUrl(); return; }
  if (current) current.life.end();
  root.textContent = '';
  const life = lifecycle();
  current = { page, life, view: null };
  current.view = VIEWS[page](root, life) || {};
  markNav(page);
  window.scrollTo(0, 0);
}
// Follows a link to one of the views in place; any other link loads as usual.
function follow(url, { replace = false } = {}) {
  const u = new URL(url, location.href);
  if (u.origin !== location.origin || !pageOf(u)) { location.href = u.href; return; }
  if (u.href !== location.href) (replace ? history.replaceState : history.pushState).call(history, null, '', u.href);
  show();
}
setFollow(follow);
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest && e.target.closest('a[href]');
  if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
  const u = new URL(a.href, location.href);
  if (u.origin !== location.origin || !pageOf(u)) return;
  e.preventDefault();
  follow(u.href);
});
window.addEventListener('popstate', show);

await initChrome(pageOf(new URL(location.href)) || 'index.html');
footer({ chart: true });
startStore();
show();
