// The wallets this site can connect to, behind one interface.
//
// The interface is the Sequentia website provider protocol
// (sequentia-extension/doc/PROVIDER.md): a method name and its params in, a result
// or an Error out, and a few named events. A connector is anything that speaks it:
//
//   { id, label, available(): Promise<bool>, request(method, params): Promise<any>,
//     on(event, fn), identity }
//
// `identity` is the `provider` string its getCapabilities must answer; a connector
// whose answer differs is refused before any other method reaches it. What a
// connector can do is the `methods` list of its getCapabilities, read through
// `railsOf` into the groups the pages ask about, so a page offers a rail only to a
// wallet that settles it.
//
// Two connectors exist:
//
// - `extension`: the Sequentia wallet extension, which injects `window.sequentia`.
// - `local`: a person's own stack (Sequentia Core, a Lightning node, a leaf wallet)
//   behind the `sequentia-connect` daemon on this computer
//   (https://github.com/ConcatenaLabs/sequentia-connect). The daemon answers on the
//   loopback address only, to the origins its owner allowed, and asks its owner in
//   its own terminal before anything is signed or paid.
//
// Neither connector holds keys here; the site sends method names and reads answers.

export const EXTENSION_ID = 'sequentia-wallet-extension';
export const LOCAL_ID = 'sequentia-connect';
export const LOCAL_DEFAULT_URL = 'http://127.0.0.1:7419';

// ---- the groups of methods a page asks about ----
// Each group is offered when the wallet serves every method listed for it.
export const RAILS = {
  account: ['connect', 'getAccounts', 'getBalances'],
  market: ['placeOrder', 'getOrders', 'cancelOrder'],
  chainFill: ['dexFillOnchain'],
  instant: ['dexSwapLn', 'dexJobResult'],
  lightning: ['lnChannels', 'createInvoice', 'payInvoice'],
  inbound: ['lnRequestInbound'],
  leaves: ['getLeafBalances', 'getLeafAddress'],
  leafOrders: ['getLeafOperator', 'takeOrder', 'getLeafTakes', 'placeOrderFromLeaves', 'getLeafOrders'],
  restingLeaves: ['restOrder', 'fillRestingOrder', 'cancelRestingOrder', 'getRestingOrders'],
  pools: ['dexFillPool'],
};

export function railsOf(methods) {
  const have = new Set(Array.isArray(methods) ? methods : []);
  const out = {};
  for (const [k, list] of Object.entries(RAILS)) out[k] = list.every((m) => have.has(m));
  return out;
}

// ---- the extension ----
export function extensionConnector(win = globalThis.window) {
  return {
    id: 'extension',
    identity: EXTENSION_ID,
    label: 'Sequentia wallet extension',
    present: () => !!(win && win.sequentia && win.sequentia.isSequentia),
    async available() { return this.present(); },
    async request(method, params = {}) {
      if (!this.present()) throw new Error('the Sequentia wallet extension is not installed');
      return await win.sequentia.request({ method, params });
    },
    on(event, fn) {
      if (!this.present()) return false;
      try { win.sequentia.on(event, fn); return true; } catch { return false; }
    },
  };
}

// ---- the daemon on this computer ----
// Requests: POST <url>/v1/request {method, params}, with the session the daemon gave
// at connect in the `x-sequentia-session` header. Events: GET <url>/v1/events?after=n,
// which the daemon holds open until one is due (or 25 s pass) and answers
// {events: [{n, event, data}], next}. The site never sends the daemon a key, a
// password or an RPC address: the daemon reads its own configuration.
export function localConnector({ url = LOCAL_DEFAULT_URL, fetchFn = globalThis.fetch, store = safeStore() } = {}) {
  const KEY = 'seqdex.local.session';
  let session = store.get(KEY);
  const handlers = new Map();
  let polling = false;
  let lastProbe = { at: 0, ok: false };

  async function post(method, params) {
    let r;
    try {
      r = await fetchFn(url + '/v1/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(session ? { 'x-sequentia-session': session } : {}) },
        body: JSON.stringify({ method, params }),
      });
    } catch (e) {
      throw new Error('Sequentia Core on this computer is not answering: start sequentia-connect, then try again');
    }
    let j = null;
    try { j = await r.json(); } catch { /* not JSON */ }
    if (!j) throw new Error('Sequentia Core on this computer gave an answer this site cannot read (HTTP ' + r.status + ')');
    if (j.error) {
      if (j.code === 'no_session') { session = null; store.del(KEY); }
      throw new Error(j.error);
    }
    return j.result;
  }

  async function poll() {
    if (polling) return;
    polling = true;
    let after = 0;
    while (handlers.size) {
      try {
        const r = await fetchFn(url + '/v1/events?after=' + after, { headers: session ? { 'x-sequentia-session': session } : {} });
        const j = await r.json();
        for (const ev of j.events || []) {
          for (const fn of handlers.get(ev.event) || []) { try { fn(ev.data); } catch {} }
        }
        after = j.next ?? after;
      } catch { await new Promise((r) => setTimeout(r, 5000)); }
    }
    polling = false;
  }

  return {
    id: 'local',
    identity: LOCAL_ID,
    label: 'Sequentia Core on this computer',
    url,
    present: () => lastProbe.ok,
    // A quiet look: the daemon answers GET /v1/hello to an allowed origin with its
    // name, and to any other origin with a refusal this site shows nobody.
    async available() {
      if (Date.now() - lastProbe.at < 3000) return lastProbe.ok;
      let ok = false;
      try {
        const r = await fetchFn(url + '/v1/hello', { cache: 'no-store' });
        const j = await r.json();
        ok = r.ok && j && j.provider === LOCAL_ID;
      } catch { ok = false; }
      lastProbe = { at: Date.now(), ok };
      return ok;
    },
    async request(method, params = {}) {
      const res = await post(method, params);
      if (method === 'connect' && res && res.session) {
        session = res.session; store.set(KEY, session);
        const { session: _s, ...account } = res;
        return account;
      }
      return res;
    },
    on(event, fn) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(fn);
      poll();
      return true;
    },
  };
}

function safeStore() {
  const ls = (() => { try { return globalThis.localStorage || null; } catch { return null; } })();
  return {
    get: (k) => { try { return ls ? ls.getItem(k) : null; } catch { return null; } },
    set: (k, v) => { try { ls && ls.setItem(k, v); } catch {} },
    del: (k) => { try { ls && ls.removeItem(k); } catch {} },
  };
}
