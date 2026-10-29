// The Markets view: the Tickers panel, whole, and the day's totals across every market.
import { $ } from '../shared/app.js';
import { assetMeta, priceUsd } from '../shared/meta.js';
import { mountTickers, fmtUsd, tk } from './tickers-panel.js';
import { rowsOfTicker } from '../shared/tickers.js';
import { state, subscribe } from './store.js';

const HTML = `
  <div class="t-card t-markets">
    <div class="t-stats">
      <h1>Markets</h1>
      <div class="t-stat"><span class="t-k">Markets</span><span class="v" id="stMarkets">-</span></div>
      <div class="t-stat"><span class="t-k">24h volume</span><span class="v" id="stVolume">-</span></div>
      <div class="t-stat"><span class="t-k">Trades 24h</span><span class="v" id="stTrades">-</span></div>
    </div>
    <div id="tickers"></div>
    <p class="t-small" style="padding:10px 16px 14px">Each price is the last trade, in the asset named beside it. Volume is in US dollars, the same for both rows of a market.</p>
  </div>`;

export function mountMarkets(root, life) {
  root.innerHTML = HTML;
  document.title = 'SeqDEX · Markets';
  let held = new Set();
  const panel = mountTickers($('tickers'), {
    held: () => held,
    onData(tickers) {
      if (!life.alive) return;
      let vol = 0, trades = 0;
      for (const t of tickers) { const [r] = rowsOfTicker(t, assetMeta, priceUsd, tk); vol += r.volume || 0; trades += t.trades_24h || 0; }
      $('stMarkets').textContent = String(tickers.length);
      $('stVolume').textContent = '$' + fmtUsd(vol, 2);
      $('stTrades').textContent = trades.toLocaleString('en-US');
    },
  });
  life.add(panel.stop);
  life.add(subscribe((s) => {
    const next = new Set(Object.entries(s.held).filter(([, v]) => { try { return BigInt(v || 0) > 0n; } catch { return false; } }).map(([h]) => h));
    if ([...next].join() !== [...held].join()) { held = next; panel.redraw(); }
  }));
  return {};
}
