// THE TRACE AMBIENT (CO2.3) — what `trace()` reads, on both sides.
//
// The third ADOPTED AMBIENT (see `adoptedAmbient.ts`), and the one that was not one at all until
// recently: `route` and `identity` each had a reactive holder, `trace` wrote a plain field on the
// reactive scope, so `{trace()}` in a binding rendered once and then showed a STALE id forever.
//
//   isValid   — untrusted-shaped: the value arrives off the wire (a hydration seed, or a param-nav
//               confirm's `traceresponse` header), and the invariant callers rely on is "a valid
//               traceparent or undefined". A malformed one would ride into log lines and outgoing
//               headers, so it is DROPPED and the previous trace stands.
//   changed   — default (identity). A traceparent is a string, so identity comparison IS value
//               comparison; re-adopting the same id wakes nobody.
//   fromScope — the one server rung that MINTS rather than merely reading. Minting is request-scoped
//               by ADR 0026, because only a unit of work that is itself a server request may name a
//               trace: the router seeds `traceparent` from an incoming header when present (so a
//               browser→server(→server) chain shares one trace id) and otherwise mints per request, and
//               a scope that never went through the router (a bare script, a cron tick) mints lazily on
//               first read and caches it for that scope's lifetime.
//   absent    — OMITTED, i.e. `undefined`. The browser never mints one: an id generated there would
//               name a trace no server span belongs to, which is worse than answering nothing.

import { adoptedAmbient } from './adoptedAmbient.ts'
import { generateTraceparent } from './generateTraceparent.ts'
import { peekReactiveScope } from './reactiveScope.ts'
import { TRACEPARENT_PATTERN } from './TRACEPARENT_PATTERN.ts'

export const traceAmbient = adoptedAmbient<string>({
    isValid: (value): value is string =>
        typeof value === 'string' && TRACEPARENT_PATTERN.test(value),
    fromScope: () => {
        const scope = peekReactiveScope()
        if (scope === undefined || scope.requestScoped !== true) return undefined
        if (scope.traceparent === undefined) scope.traceparent = generateTraceparent()
        return scope.traceparent
    },
})
