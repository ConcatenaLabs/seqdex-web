// window.sequentia glue: detection, connect state, and typed request helpers.
// The site never holds keys; every sensitive call round-trips the extension.
// Only the methods this site actually uses get a wrapper: anything that
// touches UTXOs, PSETs or invoices is the wallet's business and stays out of
// this file so it can never be called from here by accident.

// The identity string the genuine extension answers to getCapabilities
// (sequentia-extension/doc/PROVIDER.md). Any page script can define a
// window.sequentia of its own; this check is what keeps a look-alike from
// harvesting a connect.
const PROVIDER_ID = 'sequentia-wallet-extension';

let cachedAccount = null;
const listeners = new Set();

export function hasWallet() {
  return !!(window.sequentia && window.sequentia.isSequentia);
}

export function account() { return cachedAccount; }

export function onAccountChange(fn) { listeners.add(fn); }
function emit() { for (const fn of listeners) { try { fn(cachedAccount); } catch {} } }

// ---- provider identity ----
// Resolved once per page: the first request of any kind waits on it, so no
// method ever reaches a provider that did not identify itself. A failed check
// is not cached, so a transient error (the extension reloading) is retried
// on the next call rather than locking the page out until reload.
let genuine = null;
function assertGenuine() {
  if (genuine) return genuine;
  const p = (async () => {
    let caps;
    try { caps = await window.sequentia.request({ method: 'getCapabilities', params: {} }); }
    catch (e) { throw new Error('the wallet provider did not identify itself: ' + (e && e.message ? e.message : e)); }
    if (!caps || caps.provider !== PROVIDER_ID) {
      throw new Error('refusing an unrecognised wallet provider on this page; install the Sequentia wallet extension and reload');
    }
    return caps;
  })();
  genuine = p;
  p.catch(() => { if (genuine === p) genuine = null; });
  return p;
}

export async function request(method, params = {}) {
  if (!hasWallet()) throw new Error('the Sequentia wallet extension is not installed');
  if (method !== 'getCapabilities') await assertGenuine();
  return await window.sequentia.request({ method, params });
}

// Silent session restore: succeeds only if the origin is connected AND the
// wallet is unlocked; never prompts.
export async function restore() {
  if (!hasWallet()) return null;
  try {
    const { accounts } = await request('getAccounts');
    cachedAccount = accounts && accounts[0] ? accounts[0] : null;
  } catch { cachedAccount = null; }
  emit();
  return cachedAccount;
}

// Explicit connect (prompts once per origin; doubles as unlock when locked).
// The identity check runs first, so an impostor never gets to show its own
// "approval" dialog on the strength of a click meant for the real wallet.
export async function connect() {
  cachedAccount = await request('connect');
  emit();
  return cachedAccount;
}

// ---- provider lifecycle ----
// The extension's inpage script is injected at document_start, but it can
// still land after this module has run: an extension enabled or updated while
// the tab is open, or a page restored from the back/forward cache. The
// provider announces itself with a window event; everything that wires the
// provider registers here so it runs exactly once, whether the provider was
// there at init or arrived later.
const pending = new Set();
function fireReady() {
  if (!hasWallet()) return;
  for (const fn of pending) {
    pending.delete(fn);
    try { fn(); } catch (e) { console.warn('[provider]', e); }
  }
}
export function onProvider(fn) {
  pending.add(fn);
  fireReady();
}
window.addEventListener('sequentia#initialized', fireReady);

let watching = false;
export function watchEvents() {
  if (!hasWallet() || watching) return;
  watching = true;
  window.sequentia.on('accountsChanged', () => { restore(); });
  window.sequentia.on('disconnect', () => { cachedAccount = null; emit(); });
}

// Subscribe to a provider event. Returns false when there is no provider yet;
// callers that need the subscription to survive late injection go through
// onProvider.
export function onEvent(event, fn) {
  if (!hasWallet()) return false;
  try { window.sequentia.on(event, fn); return true; } catch { return false; }
}

// The wallet's mode ('developer' | 'user'); null when it cannot say. Needs no
// connection. The developer-mode rooms are drawn only while it says 'developer'.
export async function walletMode() {
  try { return (await request('getWalletMode')).mode || null; } catch { return null; }
}

// Whether the wallet serves a method (its getCapabilities list): an older wallet is told
// to update rather than met with an unknown-method error.
export async function supports(method) {
  try { const caps = await assertGenuine(); return Array.isArray(caps.methods) && caps.methods.includes(method); }
  catch { return false; }
}

// ---- typed helpers over the raw protocol (only what the site calls) ----
export const getBalances = () => request('getBalances');
export const lnChannels = () => request('lnChannels');
export const lnRequestInbound = (amount, asset) => request('lnRequestInbound', { amount, asset });
