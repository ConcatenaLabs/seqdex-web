import { initChrome, footer, $, el } from '../shared/app.js';
import { assetMeta, fmtAtoms, policyHex, assetByTicker } from '../shared/meta.js';
import * as P from '../shared/provider.js';

await initChrome('channels.html');
footer();

// The marketplace sells inbound capacity for a FIXED catalog: BTC plus the
// faucet assets. Deliberately NOT the connected wallet's holdings: the asset
// a user most wants inbound capacity for is usually one they do not hold yet,
// and a wallet can hold assets this marketplace does not serve.
const FAUCET_TICKERS = ['USDX', 'EURX', 'GOLD', 'SILVR', 'OILX'];
async function fillAssets() {
  const sel = $('inAsset');
  // Rebuilt on every account change (the registry may have landed since); the
  // user's in-progress choice survives the rebuild when it is still offered.
  const was = sel.value;
  sel.textContent = '';
  const add = (v, label) => { const o = el('option', null, label); o.value = v; sel.appendChild(o); };
  add('BTC', 'BTC (testnet4)');
  add(policyHex(), 'tSEQ');
  for (const t of FAUCET_TICKERS) {
    const id = assetByTicker(t);
    if (id) add(id, t);
  }
  if (was && Array.from(sel.options).some((o) => o.value === was)) sel.value = was;
}

async function renderChannels() {
  const body = $('chanBody');
  const intro = $('chanIntro');
  body.textContent = '';
  if (!P.account()) {
    intro.textContent = P.hasWallet()
      ? 'Connect the wallet to see your Lightning channels.'
      : P.NO_WALLET;
    return;
  }
  intro.textContent = 'Loading channel state from your wallet…';
  try {
    const { deployed, channels } = await P.lnChannels();
    if (!deployed) { intro.textContent = 'Lightning is not reachable from the wallet right now.'; return; }
    if (!channels.length) {
      intro.textContent = 'No Lightning channels yet. Buy inbound capacity on the right, or move funds to Lightning from the wallet.';
      return;
    }
    intro.textContent = 'Capacity on your own device-signed channels:';
    for (const c of channels) {
      const meta = c.kind === 'BTC' ? { ticker: 'BTC', precision: 8 } : assetMeta(c.kind);
      const tr = el('tr');
      const tk = el('td', null, meta.ticker); tk.style.fontFamily = 'var(--disp)'; tk.style.fontWeight = '700';
      tr.appendChild(tk);
      tr.appendChild(el('td', null, c.scid || '·'));
      tr.appendChild(el('td', 'bid', fmtAtoms(c.spendable, meta.precision ?? 8)));
      tr.appendChild(el('td', 'ask', c.receivable != null ? fmtAtoms(c.receivable, meta.precision ?? 8) : 'n/a'));
      body.appendChild(tr);
    }
  } catch (e) {
    intro.textContent = 'Could not read channels: ' + e.message;
  }
}

$('btnInbound').onclick = async () => {
  const st = $('inStatus');
  st.className = 'status'; st.textContent = '';
  if (!P.account()) {
    try { await P.connect(); } catch (e) { st.className = 'status err'; st.textContent = e.message; return; }
  }
  const kind = $('inAsset').value;
  const meta = kind === 'BTC' ? { ticker: 'BTC', precision: 8 } : assetMeta(kind);
  let atoms;
  try {
    const v = ($('inAmt').value || '').trim();
    if (!/^\d+(\.\d+)?$/.test(v)) throw new Error('enter a valid amount');
    const [i, f = ''] = v.split('.');
    if (f.length > (meta.precision ?? 8)) throw new Error('max ' + meta.precision + ' decimals');
    atoms = BigInt(i) * 10n ** BigInt(meta.precision ?? 8) + BigInt((f + '0'.repeat(meta.precision ?? 8)).slice(0, meta.precision ?? 8) || '0');
    if (atoms <= 0n) throw new Error('enter an amount greater than zero');
  } catch (e) { st.className = 'status err'; st.textContent = e.message; return; }
  $('btnInbound').disabled = true;
  st.textContent = 'Waiting for wallet approval, then provisioning… this can take a minute.';
  try {
    await P.lnRequestInbound(atoms.toString(), kind === 'BTC' ? undefined : kind);
    st.className = 'status ok';
    st.textContent = 'Done. Inbound capacity for ' + meta.ticker + ' is being arranged; your channel state updates below.';
    renderChannels();
  } catch (e) {
    st.className = 'status err';
    st.textContent = 'Failed: ' + e.message;
  } finally {
    $('btnInbound').disabled = false;
  }
};

P.onAccountChange(() => { renderChannels(); fillAssets(); });
await fillAssets();
await renderChannels();
