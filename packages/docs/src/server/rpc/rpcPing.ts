import { GET } from 'abide/server/GET'

// An ordinary read. There is no `HEAD` helper (ADR 0027 D6) — HTTP `HEAD` IS `GET` minus the body, so
// the router derives it: a HEAD request reaches THIS handler and the body is dropped. The demo fetches
// it with a raw `method: "HEAD"` to show exactly that — a 200 status line, headers only, no second
// declaration anywhere.
export default GET((): { ok: boolean } => ({ ok: true }))
