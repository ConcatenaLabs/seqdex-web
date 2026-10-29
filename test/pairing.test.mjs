// The connectors to a wallet that is not injected into the page (the extension's
// doc/PAIRING.md): the web wallet over a BroadcastChannel, and a paired phone over a relay,
// with real NIP-44 encryption and event signatures and an in-memory relay.
import test from 'node:test'
import assert from 'node:assert/strict'
import NostrTools from '../shared/vendor/nostr-tools.js'
import { webWalletConnector, remoteConnector, PAIR_PROTOCOL } from '../shared/connectors.js'

const T = NostrTools
const mem = () => { const m = new Map(); return { get: (k) => m.get(k) ?? null, set: (k, v) => m.set(k, v), del: (k) => m.delete(k) } }

// One relay in memory: what is published reaches every subscription whose filter takes it.
function bus () {
  const subs = new Set()
  const published = []
  class Pool {
    subscribeMany (relays, f, p) { const s = { f, p }; subs.add(s); return { close: () => subs.delete(s) } }
    publish (relays, ev) {
      published.push(ev)
      for (const s of [...subs]) {
        if (s.f.kinds && !s.f.kinds.includes(ev.kind)) continue
        const p = ev.tags.find((t) => t[0] === 'p')
        if (s.f['#p'] && !(p && s.f['#p'].includes(p[1]))) continue
        setTimeout(() => s.p.onevent(ev), 0)
      }
      return relays.map(() => Promise.resolve('ok'))
    }
  }
  return { Pool, published, subs }
}

// A wallet on the other side of a pairing URI: answers the secret, then each request.
function phone (B, uri, { secret: forceSecret, answer } = {}) {
  const u = new URL(uri.replace('nostrconnect://', 'https://x/'))
  const client = u.pathname.slice(1)
  const sk = T.generateSecretKey()
  const pk = T.getPublicKey(sk)
  const ck = T.nip44.getConversationKey(sk, client)
  const pool = new B.Pool()
  const send = (obj) => pool.publish(['r'], T.finalizeEvent({ kind: 24133, created_at: Math.floor(Date.now() / 1000), tags: [['p', client]], content: T.nip44.encrypt(JSON.stringify(obj), ck) }, sk))
  pool.subscribeMany(['r'], { kinds: [24133], '#p': [pk] }, { onevent: (ev) => {
    if (ev.pubkey !== client) return
    const m = JSON.parse(T.nip44.decrypt(ev.content, ck))
    if (m.id) Promise.resolve(answer(m)).then((r) => send({ id: m.id, ...r }))
  } })
  send({ id: 'p1', result: forceSecret ?? u.searchParams.get('secret') })
  return { pk, params: u.searchParams, send }
}

test('a phone pairs with the secret, then answers requests encrypted between the two keys only', async () => {
  const B = bus()
  const c = remoteConnector({ loadTools: async () => ({ ...T, SimplePool: B.Pool }), store: mem(), relays: ['wss://r.example'], origin: 'https://sequentiatestnet.com' })
  const { uri, paired } = await c.pair()
  assert.match(uri, /^nostrconnect:\/\/[0-9a-f]{64}\?relay=wss%3A%2F%2Fr\.example&secret=[0-9a-f]{32}&name=SeqDEX&url=https%3A%2F%2Fsequentiatestnet\.com&protocol=/)
  assert.ok(uri.endsWith('protocol=' + PAIR_PROTOCOL))
  // A wallet that does not hold the secret is not paired.
  phone(B, uri, { secret: 'ff'.repeat(16), answer: () => ({ result: 'nope' }) })
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(c.present(), false)
  const p = phone(B, uri, { answer: (m) => (m.method === 'placeOrder' ? { error: 'the user rejected the request' } : { result: { provider: 'ambra', echo: m.params } }) })
  const w = await paired
  assert.equal(w, p.pk); assert.equal(c.present(), true)
  // Nothing on the relay is readable as text.
  assert.ok(B.published.every((ev) => !/getCapabilities|ambra|placeOrder/.test(ev.content)))
  assert.deepEqual(await c.request('getCapabilities', { a: 1 }), { provider: 'ambra', echo: { a: 1 } })
  await assert.rejects(c.request('placeOrder', { type: 'market' }), /the user rejected the request/)
  // A second wallet answering the same code once paired is ignored: the secret is used up.
  phone(B, uri, { answer: () => ({ result: 'forged' }) })
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(c.paired().wallet, p.pk)
  assert.deepEqual(await c.request('getCapabilities', {}), { provider: 'ambra', echo: {} })
  // The wallet forgets the site: the site forgets the pairing.
  p.send({ event: 'disconnect' })
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(c.present(), false)
})

test('the web wallet: hello, one wallet page addressed, events from it only', async () => {
  const chans = []
  const mk = () => { const ch = { onmessage: null, postMessage: (m) => { for (const o of chans) if (o !== ch && o.onmessage) setTimeout(() => o.onmessage({ data: m }), 0) } }; chans.push(ch); return ch }
  const wallets = ['w1', 'w2'].map((id) => {
    const ch = mk(); const seen = []
    ch.onmessage = ({ data: m }) => {
      if (m.type === 'hello') ch.postMessage({ type: 'here', to: m.from, wallet: id, provider: 'sequentia-web-wallet', mode: 'user' })
      if (m.type === 'request' && m.wallet === id) { seen.push(m.method); ch.postMessage({ type: 'answer', id: m.id, to: m.from, wallet: id, ok: m.method !== 'placeOrder', result: { by: id }, error: 'the user rejected the request' }) }
    }
    return { id, ch, seen }
  })
  const c = webWalletConnector({ makeChannel: mk, win: {} })
  assert.equal(c.present(), false)
  assert.equal(await c.available(), true)
  const r = await c.request('getBalances', {})
  const by = r.by
  assert.ok(by === 'w1' || by === 'w2')
  assert.equal(wallets.find((w) => w.id !== by).seen.length, 0)
  await assert.rejects(c.request('placeOrder', {}), /the user rejected the request/)
  const heard = []
  c.on('modeChanged', (d) => heard.push(d))
  wallets.find((w) => w.id !== by).ch.postMessage({ type: 'event', event: 'modeChanged', data: { mode: 'x' }, wallet: wallets.find((w) => w.id !== by).id })
  wallets.find((w) => w.id === by).ch.postMessage({ type: 'event', event: 'modeChanged', data: { mode: 'developer' }, wallet: by })
  await new Promise((r) => setTimeout(r, 10))
  assert.deepEqual(heard, [{ mode: 'developer' }])
})
