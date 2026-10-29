// A view's lifetime: the timers, listeners and subscriptions it starts are ended together
// when the view leaves the screen, so moving between views leaves nothing running behind.
export function lifecycle() {
  const ends = [];
  let alive = true;
  return {
    get alive() { return alive; },
    every(fn, ms) { const t = setInterval(() => { if (alive) fn(); }, ms); ends.push(() => clearInterval(t)); },
    on(target, ev, fn) { target.addEventListener(ev, fn); ends.push(() => target.removeEventListener(ev, fn)); },
    add(end) { if (typeof end === 'function') ends.push(end); },
    end() { alive = false; for (const f of ends.splice(0)) { try { f(); } catch {} } },
  };
}
