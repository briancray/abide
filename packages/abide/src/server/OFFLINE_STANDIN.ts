// 21.23, 21.25 — WHAT A DEPLOY CHANGES IS NEVER OPENED STALE BY THE BROWSER'S OWN CACHE, and kept only
// to stand in where the network fails. A page names the build's hashed bundle, so a page the browser's
// cache answers stale is the build before — its stylesheet gone from the server and, once the new
// worker activates, from the device — and a visit after a deploy painted unstyled: the navigation the
// worker hands the browser goes through that cache. `max-age=0` with no `stale-while-revalidate` is
// that: never fresh, never served stale while the network answers. The copy the worker opens a page
// from is its own (45.28), dropped with the build that saved it (45.8).

export const OFFLINE_STANDIN = 'max-age=0, stale-if-error=31536000'
