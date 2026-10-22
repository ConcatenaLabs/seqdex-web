// Relay book client. Each surface reads its own mount; there is no unified
// book by design.
//   LNDEX        -> /seqob-pln  (only offers with lightning.ln_direction 2 or 3)
//   On-chain DEX -> /seqob      (same-chain, covenant, cross-chain BTC)
//   Confidential -> /seqob-conf (markets with pair.confidential == true)
import { BASE } from './meta.js';

export const MOUNTS = {
  ln: BASE + '/seqob-pln',
  chain: BASE + '/seqob',
  conf: BASE + '/seqob-conf',
  chan: BASE + '/seqob-chan', // reserved for the P2P channel-offer book; not deployed, no page reads it
};

async function getJSON(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('relay HTTP ' + r.status);
  return await r.json();
}

export async function markets(mount) {
  const j = await getJSON(MOUNTS[mount] + '/v1/markets');
  return (j.markets || []).map((m) => ({
    base: m.pair.base_asset, quote: m.pair.quote_asset,
    confidential: !!m.pair.confidential,
    bestBid: m.best_bid, bestAsk: m.best_ask, last: m.last_price,
    nOrders: Number(m.n_orders || 0),
  }));
}

export async function orderbook(mount, base, quote) {
  // The blinded book is a separate namespace on its relay, selected by query.
  const q = mount === 'conf' ? '?confidential=1' : '';
  const j = await getJSON(`${MOUNTS[mount]}/v1/market/${encodeURIComponent(base)}/${encodeURIComponent(quote)}/orderbook${q}`);
  // statuses[i] is offers[i]'s live state: what it can be filled for now.
  return (j.offers || []).map((o, i) => {
    const st = (j.statuses || [])[i];
    return normalizeOffer(st && st.active_amount != null ? { ...o, _active: String(st.active_amount) } : o);
  }).filter(Boolean);
}

// One offer, normalized for display. Prices are quote-atoms per base-unit,
// computed from the authenticated amounts, never from relay summary fields.
function normalizeOffer(o) {
  try {
    const baseAmt = BigInt(o.base_amount);
    if (baseAmt <= 0n) return null;
    const isBid = o.trade_dir === 'TRADE_DIR_BUY';           // maker buys base = a bid
    const quoteAmt = BigInt(isBid ? o.offer_amount : o.want_amount);
    return {
      id: o.offer_id,
      side: isBid ? 'bid' : 'ask',
      baseAtoms: baseAmt,
      quoteAtoms: quoteAmt,
      partial: !!o.allow_partial,
      minFill: BigInt(o.min_fill || 0),
      expiresAt: Number(o.expires_at_unix || 0),
      maker: o.maker_pubkey,
      lnDirection: o.lightning ? Number(o.lightning.ln_direction ?? -1) : null,
      confidential: !!o.confidential,
      covenant: !!o.covenant,
      resting: !!o.resting_leaf,
      raw: o,
    };
  } catch { return null; }
}

// The LNDEX surface: both legs Lightning, nothing else. Offer families by
// ln_direction (seqdex offer.proto LightningTerms.ln_direction; families per
// seqob-crosser/norm.go on seqdex's phase3-pure-ln branch): 0/1 submarine,
// 2/3 pure LN, 4/5 sub-asset. Only the pure family belongs here.
export function pureLnOnly(offers) {
  return offers.filter((o) => o.lnDirection === 2 || o.lnDirection === 3);
}

// The relay sweeps expiry on an interval; between sweeps an expired offer is
// still served, and a ticket on it can only fail.
export function unexpired(offers, nowSec = Math.floor(Date.now() / 1000)) {
  return offers.filter((o) => !o.expiresAt || o.expiresAt > nowSec);
}

// map with at most `limit` calls in flight; order of results is preserved.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// The LNDEX market list. /v1/markets on the pure-LN relay counts every offer
// family in n_orders (submarine, pure, sub-asset together), so a market can
// show a count and have nothing this surface will list. Each market's book
// is read once and the list is rebuilt from what is actually pure-LN and
// live: markets with none are dropped, and nOrders becomes the pure-LN count.
// A market whose book cannot be read is dropped too rather than shown with a
// number nobody verified.
export async function pureLnMarkets(mount = 'ln', mkts = null, concurrency = 6) {
  const list = mkts || await markets(mount);
  const scanned = await mapLimit(list, concurrency, async (m) => {
    try {
      const offers = unexpired(pureLnOnly(await orderbook(mount, m.base, m.quote)));
      return { ...m, nOrders: offers.length };
    } catch { return null; }
  });
  return scanned.filter((m) => m && m.nOrders > 0);
}

// price as a display number: quote units per base unit.
export function priceOf(o, basePrec, quotePrec) {
  const b = Number(o.baseAtoms) / Math.pow(10, basePrec);
  const q = Number(o.quoteAtoms) / Math.pow(10, quotePrec);
  if (!(b > 0)) return 0;
  return q / b;
}
