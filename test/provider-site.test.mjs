// shared/provider.js serves the site that carries it: SeqDEX offers every connector, and another
// site of this origin (Emissio) offers only those its setting names, looks for no other, and
// keeps its choice under its own key.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.location = { search: '', origin: 'https://example.test', pathname: '/x/' };
const timers = [];
globalThis.setInterval = (fn) => { timers.push(fn); return 0; };

test('SeqDEX offers all four connectors, the extension first', async () => {
  delete globalThis.SEQ_PROVIDER_SITE;
  const P = await import('../shared/provider.js?seqdex');
  assert.deepEqual(P.connectors().map((c) => c.id), ['extension', 'local', 'webwallet', 'phone']);
  assert.equal(P.activeConnector().id, 'extension');
});

test('a site offering the web wallet alone reaches no other wallet', async () => {
  let fetched = 0;
  globalThis.fetch = async () => { fetched++; throw new Error('no network here'); };
  globalThis.SEQ_PROVIDER_SITE = { name: 'Emissio', choiceKey: 'emissio.connector', offer: ['webwallet', 'nonsense', 'webwallet'] };
  const P = await import('../shared/provider.js?emissio');
  assert.deepEqual(P.connectors().map((c) => c.id), ['webwallet']);
  assert.equal(P.activeConnector().id, 'webwallet');
  assert.equal(P.connectorById('extension'), null);
  await assert.rejects(P.choose('extension'), /no such wallet connector/);
  await P.choose('webwallet');
  assert.equal(store.get('emissio.connector'), 'webwallet');
  assert.equal(store.get('seqdex.connector'), undefined);
  for (const t of timers) t();
  assert.equal(fetched, 0, 'it never knocks on the daemon');
  delete globalThis.SEQ_PROVIDER_SITE;
});

test('a site offering nothing is refused at load', async () => {
  globalThis.SEQ_PROVIDER_SITE = { offer: [] };
  await assert.rejects(import('../shared/provider.js?none'), /offers no wallet connector/);
  delete globalThis.SEQ_PROVIDER_SITE;
});
