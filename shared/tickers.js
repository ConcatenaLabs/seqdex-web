// The Tickers panel's rows: every market priced every way round, grouped by base, from
// the relay's one answer for every market (GET /v1/tickers, each market in the direction
// the relay keeps it). Every pair trades both ways, so each market is two rows: its base
// priced in its quote, and its quote priced in its base. The panel shows them all ("Any"),
// grouped under each base, or only the rows priced in one anchor asset.
//
// Prices are whole quote units per whole base unit; volume is the market's last 24 hours
// in the reference currency, the same for both rows of a market.

import { quoteRank } from './market-book.js';

export const ANY = 'ANY';

// A market's last 24 hours of volume in the reference currency, valued in the asset that is
// the pair's unit of account (the quote by the wallets' rule, `quoteRank`: BTC, then the
// fiat stablecoins), else in the other one; null when neither is priced. Read either way
// round, a market gives one figure.
export function volumeOf(t, meta, refPrice, tickerOf = (h) => h) {
  const prec = (h) => (h === 'BTC' ? 8 : (meta(h).precision ?? 8));
  const sides = [[t.quote, t.quote_volume_24h], [t.base, t.volume_24h]];
  if (quoteRank(t.base, tickerOf) > quoteRank(t.quote, tickerOf)) sides.reverse();
  for (const [h, v] of sides) {
    const p = refPrice(h);
    if (v != null && p > 0) return Number(v) / 10 ** prec(h) * p;
  }
  return t.trades_24h ? null : 0;
}

// One market of /v1/tickers as its two rows. meta(h) -> { precision }; refPrice(h) -> the
// reference currency per whole unit, or null.
export function rowsOfTicker(t, meta, refPrice, tickerOf = (h) => h) {
  const b = t.base, q = t.quote;
  const bp = b === 'BTC' ? 8 : (meta(b).precision ?? 8), qp = q === 'BTC' ? 8 : (meta(q).precision ?? 8);
  const unit = (p) => (p > 0 ? p * 10 ** (bp - qp) : null);
  const last = unit(Number(t.last));
  const hi = unit(Number(t.high_24h)), lo = unit(Number(t.low_24h));
  const ch = t.change_pct_24h != null ? Number(t.change_pct_24h) : null;
  const vol = volumeOf(t, meta, refPrice, tickerOf);
  const spark = Array.isArray(t.spark_7d) ? t.spark_7d.map((p) => unit(Number(p)) || 0) : [];
  const inv = (x) => (x > 0 ? 1 / x : null);
  const market = b + '/' + q;
  return [
    { base: b, quote: q, market, last, change: ch, high: hi, low: lo, volume: vol, trades: t.trades_24h || 0, lastTs: t.last_ts || null, spark },
    { base: q, quote: b, market, last: inv(last), change: ch == null ? null : (100 / (1 + ch / 100) - 100), high: inv(lo), low: inv(hi), volume: vol, trades: t.trades_24h || 0, lastTs: t.last_ts || null, spark: spark.map((p) => inv(p) || 0) },
  ];
}

// Every row of the panel for an anchor (ANY, or an asset id), filtered by a search
// (matches the base's or the quote's ticker), grouped by base: [{ base, volume, rows }].
// Groups: BTC first, then by the base's volume over all its markets; rows in a group by
// their market's volume. With an anchor, each group is one row: the base priced in it.
export function tickerGroups(tickers, { anchor = ANY, search = '', meta, refPrice, tickerOf }) {
  const q = String(search || '').trim().toLowerCase();
  const hit = (h) => String(tickerOf(h) || '').toLowerCase().includes(q);
  const rows = [];
  for (const t of tickers || []) for (const r of rowsOfTicker(t, meta, refPrice, tickerOf)) rows.push(r);
  const groups = new Map();
  for (const r of rows) {
    const g = groups.get(r.base) || { base: r.base, volume: 0, rows: [] };
    g.volume += r.volume || 0;
    groups.set(r.base, g);
    if (anchor !== ANY && r.quote !== anchor) continue;
    if (q && !hit(r.base) && !hit(r.quote)) continue;
    g.rows.push(r);
  }
  const byVol = (x, y) => (y.volume || 0) - (x.volume || 0) || String(tickerOf(x.quote ?? x.base)).localeCompare(String(tickerOf(y.quote ?? y.base)));
  const out = [...groups.values()].filter((g) => g.rows.length);
  for (const g of out) g.rows.sort(byVol);
  out.sort((x, y) => (x.base === 'BTC' ? -1 : y.base === 'BTC' ? 1 : 0) || (y.volume - x.volume) || String(tickerOf(x.base)).localeCompare(String(tickerOf(y.base))));
  return out;
}

// The anchor choices: Any, then every asset that is in a market, BTC first, then by ticker.
export function anchorsOf(tickers, tickerOf) {
  const s = new Set();
  for (const t of tickers || []) { s.add(t.base); s.add(t.quote); }
  return [ANY, ...[...s].sort((a, b) => (a === 'BTC' ? -1 : b === 'BTC' ? 1 : String(tickerOf(a)).localeCompare(String(tickerOf(b)))))];
}

// The panel's words (the default-mode contract, SeqDEX section).
export const TICKER_WORDS = Object.freeze({
  title: 'Tickers', search: 'Search', anchor: 'Priced in', any: 'Any',
  last: 'Last', change: '24h', volume: 'Volume', noTrades: 'No trades yet', none: 'No market matches',
});
