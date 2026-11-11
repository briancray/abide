// 21.23, 21.25 — WHAT A DEPLOY CHANGES IS ASKED FOR ON EVERY LOAD, and kept only to stand in where the
// network fails. A page names the build's hashed bundle, so a page answered stale while the network
// is asked behind it is the build before — its stylesheet gone from the server and, once the new
// worker activates, from the device — and a first visit after a deploy paints unstyled. `max-age=0`
// with no `stale-while-revalidate` is that: never fresh, never served stale while the network answers.

export const OFFLINE_STANDIN = 'max-age=0, stale-if-error=31536000'
