// trace() — the current W3C Trace Context `traceparent` (CO2.3). Format is
// `version-traceid-spanid-flags` (all hex): `00-<32 hex>-<16 hex>-<2 hex>`.
//
// On the SERVER it reads the active request's reactive scope: the router seeds `traceparent` from an
// incoming `traceparent` header when present (so a browser→server(→server) chain shares one trace id)
// and otherwise mints one for every non-asset request, which is why a server `trace()` inside a
// request effectively always answers. A scope that never went through the router (a bare script, a
// cron tick) mints one lazily on first read and caches it for that scope's lifetime.
//
// On the CLIENT it returns the trace ADOPTED from the server (`adoptTrace`) — the traceparent of the
// request that rendered the live page, refreshed on every navigation — so a browser log line
// correlates with the server span that produced what it is logging about. The browser never mints
// one: an id generated here would name a trace no server span belongs to, which is worse than
// `undefined`. Before any page hydrates (and with no scope at all) the answer is undefined.

import { generateTraceparent } from './internal/generateTraceparent.ts'
import { peekReactiveScope } from './internal/reactiveScope.ts'
import { readClientTrace } from './internal/traceHolder.ts'

export function trace(): string | undefined {
    const scope = peekReactiveScope()
    // Minting is REQUEST-scoped (ADR 0026): only a unit of work that is itself a server request may
    // name a trace. That path is unchanged — it reads and mints on the scope, per request.
    if (scope !== undefined && scope.requestScoped === true) {
        if (scope.traceparent === undefined) {
            scope.traceparent = generateTraceparent()
        }
        return scope.traceparent
    }
    // Everywhere else — the browser's tab singleton above all — the answer is whatever was ADOPTED.
    // Reading the holder SUBSCRIBES, so `{trace()}` re-renders when a navigation adopts a new id; it
    // used to read a plain scope field and so showed the first page's id forever.
    return readClientTrace()
}
