// trace() — the current W3C Trace Context `traceparent` (CO2.3). Format is
// `version-traceid-spanid-flags` (all hex): `00-<32 hex>-<16 hex>-<2 hex>`.
//
// On the server it reads the active request's reactive context: the router seeds `traceparent` from an
// incoming `traceparent` header when present, so a browser→server(→server) chain shares one trace
// id. When no header was propagated, the first `trace()` call generates one and caches it on the
// context so every subsequent read within the same request returns the same value. Returns undefined
// when there is no active request scope (bare scripts, and the browser, which never has one).

import { peekReactiveScope } from './internal/reactiveScope.ts'

export function trace(): string | undefined {
    // Gated on `requestScoped` (ADR 0026), not merely on a context existing: the browser always has a
    // context (the tab singleton) but never a request, and `trace()` has always returned undefined
    // there. Without the gate a client call would generate and cache a traceparent that means nothing.
    const context = peekReactiveScope()
    if (context?.requestScoped !== true) return undefined
    if (context.traceparent === undefined) {
        context.traceparent = generateTraceparent()
    }
    return context.traceparent
}

// version 00, sampled flag 01. 16-byte trace id, 8-byte span id, lower-case hex.
function generateTraceparent(): string {
    return `00-${randomHex(16)}-${randomHex(8)}-01`
}

function randomHex(bytes: number): string {
    const buffer = new Uint8Array(bytes)
    crypto.getRandomValues(buffer)
    let out = ''
    for (const byte of buffer) {
        out += byte.toString(16).padStart(2, '0')
    }
    return out
}
