// What the wallet holds and what it has on the books, read once for every view: the markets,
// a pair and the portfolio show the same figures and the same orders, and an order placed on
// a pair is in the portfolio at once. One poll for the whole page; a view subscribes while it
// is on screen and asks for a refresh after it changes something (an order, a take-back).
import * as P from '../shared/provider.js';
import { spendableOf } from '../shared/market-book.js';

const POLL_MS = 10_000;
export const state = {
  account: null,       // the connected account, or null
  held: {},            // asset id or 'BTC' -> atoms (the wallet's one figure)
  spendable: null,     // asset id or 'BTC' -> atoms a trade can pay from now, when the wallet says
  arriving: {},        // asset id or 'BTC' -> atoms received and not yet spendable
  balancesError: null,
  orders: null,        // getOrders' answer, or null
  ordersError: null,   // why the orders could not be read, in words
  features: new Set(), // getCapabilities' features
  mode: null,          // the wallet's mode
  at: 0,               // when this was read (ms)
};
const subs = new Set();
let inflight = null, again = false, started = false;

export function subscribe(fn) { subs.add(fn); try { fn(state); } catch (e) { console.warn('[store]', e); } return () => subs.delete(fn); }
function emit() { for (const fn of [...subs]) { try { fn(state); } catch (e) { console.warn('[store]', e); } } }

async function read() {
  state.account = P.account();
  if (!state.account) {
    Object.assign(state, { held: {}, spendable: null, arriving: {}, balancesError: null, orders: null, ordersError: null, features: new Set(), mode: null, at: Date.now() });
    return;
  }
  const [b, o, f, m] = await Promise.all([
    P.getBalances().then((v) => ({ v }), (e) => ({ e })),
    P.supports('getOrders').then((ok) => (ok ? P.request('getOrders').then((v) => ({ v }), (e) => ({ e })) : { e: new Error('update the wallet to see your orders here') })),
    P.features(),
    P.walletMode(),
  ]);
  if (b.v) {
    state.held = spendableOf(b.v); state.arriving = b.v.arriving || {}; state.balancesError = null;
    state.spendable = b.v.spendable && typeof b.v.spendable === 'object' ? { ...b.v.spendable } : null;
  }
  else state.balancesError = 'The wallet is locked or unreachable: ' + (b.e && b.e.message);
  if (o.v) { state.orders = o.v; state.ordersError = null; }
  else state.ordersError = (o.e && o.e.message) || 'unreadable';
  state.features = f; state.mode = m; state.at = Date.now();
}
// Reads everything again (one read at a time; a call during a read reads once more after it).
export function refresh() {
  if (inflight) { again = true; return inflight; }
  inflight = (async () => {
    do { again = false; try { await read(); } catch (e) { console.warn('[store]', e); } emit(); } while (again);
  })().finally(() => { inflight = null; });
  return inflight;
}
// Starts the page's one poll; the views only subscribe.
export function start() {
  if (started) return;
  started = true;
  P.onAccountChange(() => refresh());
  P.onProvider(() => P.onEvent('modeChanged', () => refresh()));
  refresh();
  setInterval(() => { if (document.visibilityState !== 'hidden') refresh(); }, POLL_MS);
}
