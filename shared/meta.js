// Asset metadata (registry) + prices. Display-only mirrors of the wallet's
// rules: user-facing names come from the registry, tickers and names are
// untrusted text and must be clamped by the UI, precision defaults are never
// guessed for real sends (the wallet enforces that side).

export const BASE = location.origin.includes('sequentiatestnet.com') ? location.origin : 'https://sequentiatestnet.com';

const POLICY_HEX = 'c8eccacf0953e1931cd31e434d8319101cc36e6c38b0e2104d8687552fae3e40';

let REGISTRY = {};
let PRICES = {};

export async function loadMeta() {
  await Promise.allSettled([
    fetch(BASE + '/registry/index.minimal.json', { cache: 'no-store' }).then((r) => r.json()).then((idx) => {
      const m = {};
      // Registry strings are untrusted; every render path puts them through
      // textContent (shared/app.js el), so the only clamp needed is length.
      const clamp = (s, n) => (typeof s === 'string') ? s.slice(0, n) : s;
      for (const [id, v] of Object.entries(idx)) if (Array.isArray(v)) m[id] = { ticker: clamp(v[1], 16), name: clamp(v[2], 48), precision: v[3], domain: v[0], verified: !!v[4], supervised: !!v[5] };
      REGISTRY = m;
    }),
    fetch(BASE + '/prices', { cache: 'no-store' }).then((r) => r.json()).then((d) => {
      const m = {};
      for (const [t, v] of Object.entries(d)) { const p = (v && typeof v === 'object') ? v.price : v; if (p > 0) m[t.toUpperCase()] = p; }
      PRICES = m;
    }),
  ]);
}

export function assetMeta(hex) {
  if (!hex) return { ticker: '?', name: '', precision: 8 };
  if (hex === 'BTC') return { ticker: 'BTC', name: 'Bitcoin testnet4', precision: 8 };
  if (hex === POLICY_HEX) return { ticker: 'tSEQ', name: 'Sequence', precision: 8 };
  // No baked-in table of ids: a stale one names the wrong asset, which is
  // worse than a truncated id while the registry is still loading.
  return REGISTRY[hex] || { ticker: hex.slice(0, 6) + '…', name: 'Asset ' + hex.slice(0, 10) + '…', precision: 8 };
}
export function policyHex() { return POLICY_HEX; }
// Id-by-ticker resolution for fixed catalogs (channel marketplace). Pinned to
// the sequentia.io issuer domain so a squatter ticker on another domain cannot
// hijack a catalog slot.
export function assetByTicker(ticker, domain = 'sequentia.io') {
  for (const [id, m] of Object.entries(REGISTRY)) {
    if (m.ticker === ticker && (!domain || m.domain === domain)) return id;
  }
  return null;
}

// SEQUENTIA: whether this asset's issuer can freeze holdings of it by consensus
// rule (Sequentia src/supervision.h). Part of the asset's identity, committed in
// its id, so it can never be added or removed later.
//
// It matters more here than almost anywhere else: a trader is about to ACQUIRE
// the asset, and a resting order is a standing offer to acquire more. What a
// freeze reaches is worth stating precisely, because the answer is favourable
// to the DEX and counter-intuitive: an ordinary address holding the asset can
// be frozen, but a channel, an HTLC or a covenant cannot, since the frozen
// party is not the only party to those funds. So settlement in flight is never
// caught halfway.
export function assetSupervised(hex) {
  if (!hex || hex === 'BTC' || hex === POLICY_HEX) return false;
  const r = REGISTRY[hex];
  return !!(r && r.supervised);
}

// One sentence for a tooltip or a badge, wherever a market names an asset.
export function supervisionNote(hex) {
  if (!assetSupervised(hex)) return '';
  return 'Supervised asset: its issuer can freeze holdings at ordinary addresses. '
       + 'Funds in a channel, an HTLC or a covenant are out of reach, so a swap in flight cannot be caught halfway, '
       + 'and the issuer can never spend your coins.';
}

export function fmtAtoms(atoms, d) {
  let a = BigInt(atoms); const neg = a < 0n; if (neg) a = -a;
  const base = 10n ** BigInt(d);
  let s = (a / base).toString();
  if (d > 0) { const f = (a % base).toString().padStart(d, '0').replace(/0+$/, ''); if (f) s += '.' + f; }
  return (neg ? '-' : '') + s;
}

// Locale-free price formatting, up to 8 decimals, trailing zeros dropped.
// Inputs on the ticket accept only digits and a point, so what the book shows
// must read the same way: no thousands separators, no locale decimal comma.
export function fmtPrice(p) {
  if (!Number.isFinite(p)) return '·';
  return p.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
}

// The price of one whole unit of an asset in the reference currency, or null.
export function priceUsd(hex) {
  const t = hex === 'BTC' ? 'BTC' : (hex === POLICY_HEX ? 'SEQ' : assetMeta(hex).ticker);
  const p = PRICES[String(t).toUpperCase()] || (t === 'BTC' ? PRICES.TBTC : null);
  return p > 0 ? p : null;
}

export function usdFor(hex, atoms) {
  const t = hex === 'BTC' ? 'BTC' : (hex === POLICY_HEX ? 'SEQ' : assetMeta(hex).ticker);
  const p = PRICES[String(t).toUpperCase()] || (t === 'BTC' ? PRICES.TBTC : null);
  if (!(p > 0)) return null;
  const units = Number(BigInt(atoms)) / Math.pow(10, assetMeta(hex).precision || 8);
  return units * p;
}
