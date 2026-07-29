// #demo platformHealth
import { GET } from 'abide/server/GET'
import { health } from 'abide/shared/health'

// `health()` is isomorphic AND symmetric in CONTENT: here on the server it composes the whole document
// in-proc — the framework baseline `{ reachable, version, startedAt, uptime }` with this app's
// `onHealth()` merged over it — while in the browser the same call awaits a fetch of `/__abide/health`.
// Same import, same call, same document.
//
// This handler also exists to make the TYPE load-bearing. `abide` generates `src/.abide/health.d.ts`
// from this app's `onHealth` return type, so `doc.bootId` below is a CHECKED read: it type-checks here
// and is a compile error in an app that declares no such hook. The two browser demos read the document
// through a `state(null)` cell, which the checker widens to `any` — so neither of them consults the
// generated companion, and neither can catch it regressing. This one can.
export default GET(async () => {
    const doc = await health()
    return { reachable: doc.reachable, app: doc.app, bootId: doc.bootId }
})
// #enddemo
