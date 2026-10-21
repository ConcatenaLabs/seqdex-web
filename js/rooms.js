import { initChrome, footer, $, el } from '../shared/app.js';
import { markets, pureLnMarkets } from '../shared/book.js';
import * as P from '../shared/provider.js';

const acc = await initChrome('rooms.html');
footer();

// The leaves room is a developer-mode room: its tile is drawn only while the wallet
// says it is in developer mode.
function leafTile(mode) {
  const have = document.getElementById('tileLeaves');
  if (mode !== 'developer') { if (have) have.remove(); return; }
  if (have) return;
  const a = el('a', 'tile tile-leaf');
  a.id = 'tileLeaves';
  a.href = 'leaves.html';
  const h = el('h3');
  h.appendChild(el('small', null, 'Developer mode · leaves'));
  h.appendChild(document.createTextNode('Leaves room'));
  a.appendChild(h);
  a.appendChild(el('p', null, 'Fill on-chain orders from your leaves through your operator\u2019s round, and place orders on the chain from them. Shown because your wallet is in developer mode.'));
  document.querySelector('.tiles').appendChild(a);
}
P.onProvider(() => {
  P.walletMode().then(leafTile).catch(() => {});
  P.onEvent('modeChanged', (d) => leafTile(d && d.mode));
});

// A tile's live line is built from nodes, never from markup: the numbers come
// from the relay and the wallet, and nothing fetched is ever concatenated
// into HTML. Pass strings for plain text and [n] for a highlighted number.
function live(id, ...parts) {
  const box = $(id);
  box.textContent = '';
  parts.forEach((part, i) => {
    if (i) box.appendChild(document.createTextNode(' · '));
    if (Array.isArray(part)) {
      box.appendChild(el('b', null, String(part[0])));
      box.appendChild(document.createTextNode(' ' + part[1]));
    } else {
      box.appendChild(document.createTextNode(part));
    }
  });
}

// Live tile stats from the real books; each fails soft to a plain label.
(async () => {
  try {
    // Every market's book is read, not a sample: the LNDEX definition is
    // per-offer (pure-LN only), and the relay's own counts mix in submarine
    // and sub-asset offers. Same scan the LNDEX page uses for its list.
    const mkts = await pureLnMarkets('ln');
    const offers = mkts.reduce((s, m) => s + m.nOrders, 0);
    live('liveLn', [offers, 'live pure-Lightning offers'], [mkts.length, 'markets']);
  } catch { live('liveLn', 'book unreachable right now'); }
})();

(async () => {
  try {
    const mkts = await markets('chain');
    const cross = mkts.filter((m) => m.quote === 'BTC').length;
    const n = mkts.reduce((s, m) => s + m.nOrders, 0);
    live('liveChain', [n, 'resting orders'], [mkts.length, 'markets'], [cross, 'cross-chain']);
  } catch { live('liveChain', 'book unreachable right now'); }
})();

(async () => {
  try {
    // Bitcoin has no confidential transactions; a BTC leg cannot exist in this
    // room, so a relay entry claiming one is dropped on the floor.
    const mkts = (await markets('conf')).filter((m) => m.confidential && m.base !== 'BTC' && m.quote !== 'BTC');
    live('liveConf', [mkts.length, 'confidential markets']);
  } catch { live('liveConf', 'opens with the confidential book'); }
})();

(async () => {
  if (!acc) { live('liveChan', 'connect the wallet to see your channels'); return; }
  try {
    const { deployed, channels } = await P.lnChannels();
    if (deployed) live('liveChan', [channels.length, 'of your channels active']);
    else live('liveChan', 'Lightning not deployed');
  } catch (e) { live('liveChan', 'connect the wallet to see your channels'); }
})();
