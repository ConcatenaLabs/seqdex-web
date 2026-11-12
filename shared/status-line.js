// The ticket's status line (`#fStatus`): what the page last said of an order, kept apart from the
// element that shows it. The order form is drawn again whenever what it offers changes (the
// wallet's features, the side, the type), and with it a new, empty status line. An answer the
// wallet gives while the page waits for it is written to the line on the page then, and a form
// drawn again shows what was last said, so a trade's answer is never written to a line no
// longer on the page. Pure: `find` returns the element on the page now (or null).
export function statusLine(find) {
  let now = { cls: 'status', text: '' };
  const paint = () => { const e = find(); if (e) { e.className = now.cls; e.textContent = now.text; } };
  return {
    // Says `text`, with `cls` ('status', 'status ok' or 'status err'), on the line on the page.
    say(cls, text) { now = { cls, text }; paint(); },
    // Shows what was last said on a line just drawn.
    paint,
    now: () => ({ ...now }),
  };
}
