// The wallet connectors (shared/connectors.js): the rail groups read from a wallet's
// method list, the extension connector over window.sequentia, and the daemon connector
// over HTTP, with its session kept and dropped as the daemon says.
import test from 'node:test';
import assert from 'node:assert/strict';
import { railsOf, extensionConnector, localConnector, LOCAL_ID } from '../shared/connectors.js';

const memStore = () => { const m = new Map(); return { get: (k) => m.get(k) ?? null, set: (k, v) => m.set(k, v), del: (k) => m.delete(k), m }; };

test('railsOf offers a group only when every method of it is served', () => {
  const r = railsOf(['connect', 'getAccounts', 'getBalances', 'placeOrder', 'getOrders', 'lnChannels', 'createInvoice', 'payInvoice']);
  assert.equal(r.account, true);
  assert.equal(r.market, false, 'cancelOrder is missing');
  assert.equal(r.lightning, true);
  assert.equal(r.leaves, false);
  assert.deepEqual(railsOf(null), Object.fromEntries(Object.keys(r).map((k) => [k, false])));
});

test('the extension connector passes method and params to window.sequentia', async () => {
  const seen = [];
  const win = { sequentia: { isSequentia: true, request: async (x) => { seen.push(x); return { ok: 1 }; }, on: () => {} } };
  const c = extensionConnector(win);
  assert.equal(await c.available(), true);
  assert.deepEqual(await c.request('getBalances', { a: 1 }), { ok: 1 });
  assert.deepEqual(seen, [{ method: 'getBalances', params: { a: 1 } }]);
  const none = extensionConnector({});
  assert.equal(await none.available(), false);
  await assert.rejects(none.request('connect'), /not installed/);
});

function fakeDaemon({ session = 'S1' } = {}) {
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    calls.push({ url, init });
    const u = new URL(url);
    const json = (status, j) => ({ ok: status < 400, status, json: async () => j });
    if (u.pathname === '/v1/hello') return json(200, { provider: LOCAL_ID, version: 'test' });
    if (u.pathname === '/v1/request') {
      const { method } = JSON.parse(init.body);
      const s = init.headers['x-sequentia-session'];
      if (method === 'connect') return json(200, { result: { network: 'elementsregtest', address: 'ert1qx', session } });
      if (method === 'getCapabilities') return json(200, { result: { provider: LOCAL_ID, methods: [] } });
      if (!s) return json(401, { error: 'this site is not connected; call connect first', code: 'no_session' });
      if (s !== session) return json(401, { error: 'this site is not connected; call connect first', code: 'no_session' });
      return json(200, { result: { assets: {}, btc: '0' } });
    }
    return json(404, { error: 'no' });
  };
  return { fetchFn, calls };
}

test('the daemon connector keeps the session connect gives and sends it', async () => {
  const d = fakeDaemon();
  const store = memStore();
  const c = localConnector({ url: 'http://127.0.0.1:1', fetchFn: d.fetchFn, store });
  assert.equal(await c.available(), true);
  const acc = await c.request('connect');
  assert.deepEqual(acc, { network: 'elementsregtest', address: 'ert1qx' }, 'the session is not handed to the page');
  assert.equal(store.get('seqdex.local.session'), 'S1');
  assert.deepEqual(await c.request('getBalances'), { assets: {}, btc: '0' });
  assert.equal(d.calls.at(-1).init.headers['x-sequentia-session'], 'S1');
});

test('a session the daemon no longer knows is dropped, and the refusal passed on', async () => {
  const d = fakeDaemon({ session: 'S2' });
  const store = memStore();
  store.set('seqdex.local.session', 'OLD');
  const c = localConnector({ url: 'http://127.0.0.1:1', fetchFn: d.fetchFn, store });
  await assert.rejects(c.request('getBalances'), /not connected; call connect first/);
  assert.equal(store.get('seqdex.local.session'), null);
});

test('a daemon that is not running reads as absent, and a request says how to start it', async () => {
  const fetchFn = async () => { throw new TypeError('fetch failed'); };
  const c = localConnector({ url: 'http://127.0.0.1:1', fetchFn, store: memStore() });
  assert.equal(await c.available(), false);
  await assert.rejects(c.request('connect'), /start sequentia-connect/);
});

test('an answer from something else on the port is not taken for the daemon', async () => {
  const fetchFn = async () => ({ ok: true, status: 200, json: async () => ({ provider: 'something-else' }) });
  const c = localConnector({ url: 'http://127.0.0.1:1', fetchFn, store: memStore() });
  assert.equal(await c.available(), false);
});
