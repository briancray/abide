/*
The id of the `<script type="application/json">` element the server emits the
`window.__SSR__` payload into and the client (`startClient`) parses back out
(ADR-0051). Shipping the payload as inert JSON data — not a `window.__SSR__ = {…}`
executable statement — means the browser never COMPILES a multi-MB object literal
as JavaScript on the critical path; the deferred client bundle reads it with one
`JSON.parse` (a restricted grammar parsed several times faster than equivalent JS
source). Both sides import this constant so the write id and read id can't drift.
*/
// @documentation plumbing
export const SSR_SCRIPT_ID = 'abide-ssr'
