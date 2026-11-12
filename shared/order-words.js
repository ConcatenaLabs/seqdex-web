// What the page says of a trade and of the wallet's answer to placeOrder. Pure: no DOM.

// A trade's state, as getOrders gives it: `sending` while the wallet still takes its step,
// `sent` once it has paid or signed its side, `received` once what the trade brings is the
// wallet's, then `settled`; `failed` and `returned` when it did not happen.
export const STATE_WORDS = Object.freeze({ sending: 'Sending', settled: 'Settled', received: 'Received', sent: 'Sent', failed: 'Did not settle', returned: 'Returned' });

// The wallet's answer to placeOrder, in words. A trade whose step outlasted the wallet's wait comes
// back under way (`under_way`, nothing filled yet): it is said to be under way, never traded. A
// trade that needs more of the person, such as a purchase with BTC that only an open wallet pays,
// comes with the wallet's own words for it (`note`), said after.
export function placedText(r) {
  const parts = [];
  if (r && r.under_way) parts.push('Your trade is under way.');
  if (r && r.under_way && typeof r.note === 'string' && r.note.trim()) parts.push(r.note.trim());
  if (r && r.filled) parts.push('Traded with ' + r.filled + (r.filled === 1 ? ' order' : ' orders') + '.');
  if (r && r.order) parts.push(r.filled ? 'Your order for the rest is on the book.' : 'Your order is on the book.');
  if (r && r.order_error) parts.push('The rest was not placed: ' + r.order_error + '.');
  if (r && r.failed && r.failed.length) parts.push(r.failed.length + ' order' + (r.failed.length === 1 ? ' was' : 's were') + ' taken by someone else first; nothing of yours moved for ' + (r.failed.length === 1 ? 'it' : 'them') + '.');
  parts.push('Follow it under Your orders.');
  return parts.join(' ');
}
