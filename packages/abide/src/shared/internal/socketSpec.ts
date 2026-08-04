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

// THE PROJECTED KEYS, declared — and the totality check the RPC half already has.
//
// This projection is hand-written in `clientBundle.socketSpecs`, and it is safe TODAY only because all
// three fields are required: a missing required field is a compile error at the object literal. That is
// an accident of the current shape, not a guarantee. `rpcSpec.ts` names precisely what happens when it
// stops being true — "an optional field left out of the projection is not a compile error ANYWHERE.
// That is exactly how `throttle`/`debounce` came to be set on the server, typed on the client, and
// absent in between." The rpc side learned that; the socket side was one optional field away from
// repeating it.
export const SOCKET_SPEC_KEYS = [
    'clientPublish',
    'tail',
    'maxAge',
] as const satisfies readonly (keyof SocketSpec)[]

// TOTALITY — the half `satisfies` cannot do. `satisfies` rejects a key that is not on `SocketSpec`;
// this alias catches the direction that bites, a key on `SocketSpec` that nothing projects. Asserted in
// `socketSpec.test.ts`, where the failure names the unprojected field.
export type UnprojectedSocketSpecKey = Exclude<keyof SocketSpec, (typeof SOCKET_SPEC_KEYS)[number]>

export function encodeMaxAge(maxAge: number): number | null {
    return Number.isFinite(maxAge) ? maxAge : null
}

export function decodeMaxAge(maxAge: number | null | undefined): number {
    return maxAge ?? Number.POSITIVE_INFINITY
}
