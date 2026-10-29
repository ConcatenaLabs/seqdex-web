// The Markets page: the Tickers panel, whole, and the day's totals across every market.
import { $ } from '../shared/app.js';
import { assetMeta, priceUsd } from '../shared/meta.js';
import * as P from '../shared/provider.js';
import { mountTickers, fmtUsd, tk } from './tickers-panel.js';
import { rowsOfTicker } from '../shared/tickers.js';
import { spendableOf } from '../shared/market-book.js';

export function runMarketsPage() {
  let held = new Set();
  const panel = mountTickers($('tickers'), {
    held: () => held,
    onData(tickers) {
      let vol = 0, trades = 0;
      for (const t of tickers) { const [r] = rowsOfTicker(t, assetMeta, priceUsd, tk); vol += r.volume || 0; trades += t.trades_24h || 0; }
      $('stMarkets').textContent = String(tickers.length);
      $('stVolume').textContent = '$' + fmtUsd(vol, 2);
      $('stTrades').textContent = trades.toLocaleString('en-US');
    },
  });
  async function readHeld() {
    if (!P.account()) { held = new Set(); return; }
    try {
      const b = spendableOf(await P.getBalances());
      held = new Set(Object.entries(b).filter(([, v]) => { try { return BigInt(v || 0) > 0n; } catch { return false; } }).map(([h]) => h));
    } catch { held = new Set(); }
    panel.redraw();
  }
  P.onAccountChange(readHeld);
  readHeld();
}
