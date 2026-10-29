// In-page navigation: the shell sets how a link is followed (js/shell.js); until then, or
// outside the shell, a link loads its page.
let follow = (url) => { location.href = url; };
export function go(url, opts) { follow(url, opts || {}); }
export function setFollow(fn) { follow = fn; }
