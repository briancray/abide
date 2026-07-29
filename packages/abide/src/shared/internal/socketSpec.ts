// THE SOCKET WIRE SPEC — the fields that cross from the server's registry into the client bundle.
//
// The RPC half of this got one owner (`rpcSpec.ts`); its sibling did not. The socket shape was spelled
// three times — `SocketEntry`, `clientBundle.socketSpecs`'s return type and again as that function's
// local, and `socketProxy.SocketSpec` — with nothing connecting them, which is exactly the arrangement
// `rpcSpec.ts`'s header describes as having already drifted once on the RPC side.
//
// The `Infinity ↔ null` encoding is the part most worth having in one place. JSON cannot carry
// Infinity, so a sticky `maxAge` travels as `null`; that rule was stated at the encode site in
// `server/internal/clientBundle.ts` and again at the decode site in `ui/internal/socketProxy.ts`, in
// different layers, as two expressions that happen to be inverses.

// `tail` sizes the `chunks()` cap; `maxAge` windows `peek()`; `clientPublish` gates `.publish()`
// (client-sockets.md CS7).
export interface SocketSpec {
    clientPublish: boolean
    tail: number
    // Milliseconds, or `null` for Infinity/sticky.
    maxAge: number | null
}

export function encodeMaxAge(maxAge: number): number | null {
    return Number.isFinite(maxAge) ? maxAge : null
}

export function decodeMaxAge(maxAge: number | null | undefined): number {
    return maxAge ?? Number.POSITIVE_INFINITY
}
