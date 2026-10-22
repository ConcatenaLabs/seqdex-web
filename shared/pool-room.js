// The pools room's reading of the on-chain relay: pure functions, no I/O.
//
// A maker's pool (offer member `pool`, the template seqdex/pool) is two coins at one
// address, one of the base and one of the quote. It lists two offers on the relay: its
// ask, selling the base for the quote at the pool's ask, and its bid, selling the quote
// for the base at its bid (listed on the reversed market). Each is listed at what its
// own coin holds above that coin's reserve (the relay's live size, `_active`), so a
// pool shows only what it holds. Anyone fills it on the chain at its quotes; only its
// maker's key withdraws it.
//
// A clearing round fills round orders (offer member `round_order`) at one price, which
// its last output publishes, and may move pools at their quotes. The relay serves each
// round it has seen (`/v1/rounds`): its price, its fills, the pools it moved, and where
// it stands, `confirmed` (in a block), `final` (certified, its Bitcoin anchor buried)
// or `undone` (its block left the chain with its anchor).

const big = (v) => BigInt(v ?? 0);

// Internal byte order (as the terms carry asset ids) to the display hex of the RPC.
export function displayHex(internal) {
  const s = String(internal || '').toLowerCase();
  if (s.length !== 64) return s;
  let out = '';
  for (let i = 62; i >= 0; i -= 2) out += s.slice(i, i + 2);
  return out;
}

// The pools a set of offers lists (the offers of both orientations of a pair, or of
// every market), one entry per pool: its terms, its two coins, and the two sides as
// listed. A side not listed (delisted, or never posted) is null.
export function poolsOf(offers) {
  const by = new Map();
  for (const o of offers || []) {
    const t = o && o.pool;
    if (!t) continue;
    const key = [t.base, t.quote, t.bid_num, t.bid_den, t.ask_num, t.ask_den, t.min_lot,
      t.reserve_base, t.reserve_quote, t.maker_key].join('|');
    const base = displayHex(t.base), quote = displayHex(t.quote);
    const p = by.get(key) || {
      key, base, quote,
      bid: { num: big(t.bid_num), den: big(t.bid_den) },
      ask: { num: big(t.ask_num), den: big(t.ask_den) },
      minLot: big(t.min_lot), reserveBase: big(t.reserve_base), reserveQuote: big(t.reserve_quote),
      makerKey: t.maker_key, coins: null, askSide: null, bidSide: null,
    };
    const coins = { base: `${t.base_txid}:${Number(t.base_vout || 0)}`, quote: `${t.quote_txid}:${Number(t.quote_vout || 0)}` };
    const listed = big(o._active ?? o.offer_amount);
    const sells = String(o.offer_asset || '').toLowerCase();
    if (sells === base) p.askSide = { offerId: o.offer_id, listed, coins };
    else if (sells === quote) p.bidSide = { offerId: o.offer_id, listed, coins };
    // Both sides name the pool's coins; the newer listing wins if they differ for a moment.
    p.coins = coins;
    by.set(key, p);
  }
  return [...by.values()];
}

// A pool's two sides as rows of a market's book, oriented to the market's base and
// quote: the ask sells `size` base at the pool's ask, the bid buys `size` base at its
// bid with `total` quote. Prices are quote units per base unit. Returns [] for a
// pool of another pair.
export function poolRows(pool, { base, quote, basePrec, quotePrec }) {
  if (!pool) return [];
  const scale = Math.pow(10, basePrec - quotePrec);
  const rows = [];
  const askPrice = Number(pool.ask.num) / Number(pool.ask.den);
  const bidPrice = Number(pool.bid.num) / Number(pool.bid.den);
  if (pool.base === base && pool.quote === quote) {
    if (pool.askSide && pool.askSide.listed > 0n) {
      const size = pool.askSide.listed;
      rows.push({ side: 'ask', size, total: (size * pool.ask.num + pool.ask.den - 1n) / pool.ask.den, price: askPrice * scale, id: pool.askSide.offerId, pool: true });
    }
    if (pool.bidSide && pool.bidSide.listed > 0n) {
      const total = pool.bidSide.listed;
      const size = (total * pool.bid.den) / pool.bid.num;
      if (size > 0n) rows.push({ side: 'bid', size, total, price: bidPrice * scale, id: pool.bidSide.offerId, pool: true });
    }
  } else if (pool.base === quote && pool.quote === base) {
    // The market is the pool's pair the other way round: its ask buys the market's
    // base, its bid sells it.
    if (pool.askSide && pool.askSide.listed > 0n) {
      const total = pool.askSide.listed; // the pool's base = the market's quote
      const size = (total * pool.ask.num) / pool.ask.den;
      if (size > 0n) rows.push({ side: 'bid', size, total, price: (1 / askPrice) * scale, id: pool.askSide.offerId, pool: true });
    }
    if (pool.bidSide && pool.bidSide.listed > 0n) {
      const size = pool.bidSide.listed; // the pool's quote = the market's base
      rows.push({ side: 'ask', size, total: (size * pool.bid.den + pool.bid.num - 1n) / pool.bid.num, price: (1 / bidPrice) * scale, id: pool.bidSide.offerId, pool: true });
    }
  }
  return rows;
}

const STATE_WORDS = {
  confirmed: 'in a block; final once its block is certified and its Bitcoin anchor buried',
  final: 'final: its block certified and its Bitcoin anchor buried',
  undone: 'undone: its block left the chain with its Bitcoin anchor',
};

// A round as the room shows it: its price (quote per base, in the round's own
// orientation), where it stands in words, its fills and the pools it moved.
export function roundView(r) {
  const p = r && r.price;
  const fills = (r && r.fills) || [];
  const moves = (r && r.pool_moves) || [];
  return {
    txid: r.txid,
    base: p ? p.base : null, quote: p ? p.quote : null,
    n: p ? big(p.n) : 0n, d: p ? big(p.d) : 0n,
    state: r.state, words: STATE_WORDS[r.state] || r.state,
    depth: r.anchor_depth ?? 0,
    clearer: r.clearer || '',
    fills: fills.map((f) => ({ offerId: f.offer_id, maker: f.maker_pubkey, sold: big(f.filled),
      credited: big(f.credit && f.credit.value), soldAsset: null, paidAsset: f.credit ? f.credit.asset : null,
      rests: f.rest ? big(f.remainder) : 0n, state: f.state })),
    moves: moves.map((m) => ({ sell: !!m.sell, base: big(m.base), quote: big(m.quote), after: [big(m.base_after), big(m.quote_after)], state: m.state, withdrawn: !!m.withdrawn })),
  };
}

// Newest first, as the relay serves them.
export function roundsOf(rounds) {
  return (rounds || []).map(roundView);
}

// One offer of a pool as a row of a market's book (see poolRows), or null.
export function poolRowOf(o, opts) {
  const [p] = poolsOf([o]);
  return poolRows(p, opts)[0] || null;
}
