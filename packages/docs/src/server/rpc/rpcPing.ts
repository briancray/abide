import { HEAD } from "abide/server/HEAD"

// A HEAD read RPC (identical semantics to GET). Consumed in the browser with a raw HEAD fetch so the
// demo can show a 200 status line with no body — HEAD carries headers only.
export default HEAD((): { ok: boolean } => ({ ok: true }))
