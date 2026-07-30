// THE RPC WIRE SPEC — the fields that cross from the server's registry into the client bundle.
//
// This shape was written out six times: `RpcEntry`, `clientBundle.rpcSpecs`'s return type, the same
// object type AGAIN as that function's local, `pageRegistry.RpcSpecs`, `clientProxy`'s opts, and
// `makeClientImports`'s parameter. Nothing connected them, and the wire between them is JSON built by
// string concatenation into the generated loader, so nothing type-checked the crossing either.
//
// It had already drifted. `throttle`/`debounce` — the most recent bilateral fields added — were absent
// from `pageRegistry.RpcSpecs`, the type at the `registerPages` → `pageSpecs()` → `makeClientImports`
// boundary. It worked only because the consumer's own inline copy declared them optional, so the extra
// runtime properties rode through untyped. The next field would have landed the same way.
//
// This is the shape half of the same lesson `rpcMemoPolicy` and `rpcUrl` already learned for the
// POLICY and the ADDRESS: `rpcMemoPolicy`'s own comment records that "re-deriving a default here is how
// a fourth copy of the policy grew in `makeClientImports`", and `registry` records a second derivation
// of `ttl` that shipped `null` where the server ran `0`. The policy got one owner; the shape it travels
// in did not.

// Why each field crosses at all — one statement, rather than one per copy:
export interface RpcSpec {
    method: string
    read: boolean
    // Opt-in server cross-request cache (rpc-core §2). Surfaced so the client bundle can flag the read
    // proxy: a crossRequest read auto-subscribes to its broadcast channel (shared-cache-plan §2.5).
    crossRequest: boolean
    // Whether the bare CALL routes through the memo. The client proxy mirrors it: `false` means the call
    // bypasses the client memo (direct fetch, at-least-once). It is NOT simply `memo !== false` — under
    // `memo: false` a MUTATION bypasses while a READ still routes through at ttl:0, which is what the
    // server does, so the flag carries the normalizer's verb-aware answer (`rpcMemoPolicy`).
    memo: boolean
    // Retained-value TTL the client memo should use (ms). `null` = Infinity (retain until invalidate) —
    // a read's default; a mutation defaults to `0` (coalesce concurrent, retain nothing), as does
    // `memo: false` on either verb. Symmetry: an author who sets `memo: { ttl }` gets that retention on
    // both sides, and one who sets `memo: false` gets NO retention on both sides.
    ttl: number | null
    // Cache tags (rpc-core §8). Carried to the client for the same reason `ttl` is: the tag verbs are
    // isomorphic, so a `refresh({ tags })`/`invalidate({ tags })` in the browser has to be able to
    // select this read's client memo. Omitted when the author declared none.
    tags?: string[]
    // The SWR refetch clock (rpc-core §3), carried for the same reason `ttl` and `tags` are: it is
    // bilateral, and the client half is the one that matters most — a broadcast storm calling
    // `fn.refresh()` is a browser-side stream of triggers. Omitted when the author declared neither, so
    // the common spec stays two fields lighter in the bundle.
    throttle?: number
    debounce?: number
    // The resolved run deadline in ms (ADR 0028), `0` when unbounded. Surfaced so the browser proxy
    // arms the SAME number the server does — bilateral means two independent enforcements (D6), not one
    // timer with two ends. BAKED at build time: `ABIDE_RPC_TIMEOUT` retunes the server on deploy while
    // the browser keeps whatever `abide build` wrote, which is accepted because the client half is a UX
    // bound and a deploy-time retune of a UX bound does not earn a hydration-seed field.
    timeout: number
}

// EVERY FIELD THAT CROSSES, NAMED ONCE — and the projection that writes them.
//
// The type having one owner fixed the two ENDS and left the crossing itself hand-written: the client
// bundle enumerated six fields into a literal, then appended three more under `!== undefined` guards,
// behind an `as` cast. The cast is what made that dangerous — an object literal missing a REQUIRED field
// is an error, but an assertion admits it, so the compiler could not see a field that stopped crossing
// even though `RpcEntry extends RpcSpec` had made the source of truth checkable.
//
// The optional half was worse, and is the drift this module was created for: `tags`/`throttle`/`debounce`
// are written only when the author declared them (an empty array or two `undefined`s in every spec would
// weigh the bundle down for the common case), and an optional field left out of the projection is not a
// compile error ANYWHERE. That is exactly how `throttle`/`debounce` came to be set on the server, typed
// on the client, and absent in between.
export const RPC_SPEC_KEYS = [
    'method',
    'read',
    'crossRequest',
    'memo',
    'ttl',
    'timeout',
    'tags',
    'throttle',
    'debounce',
] as const satisfies readonly (keyof RpcSpec)[]

// TOTALITY — the half `satisfies` cannot do. `satisfies` rejects a key that is not on `RpcSpec`; this
// alias catches the direction that actually bites, a key on `RpcSpec` that nothing projects. It is
// asserted in `rpcSpec.test.ts`, where the failure names the unprojected field.
export type UnprojectedRpcSpecKey = Exclude<keyof RpcSpec, (typeof RPC_SPEC_KEYS)[number]>

// The registry entry → the wire spec. `RpcEntry extends RpcSpec`, so this is a projection rather than a
// translation: every declared field is written, and an absent optional one is omitted rather than sent as
// `undefined` (which would survive `JSON.stringify` as nothing but does weigh the emitted literal).
export function rpcSpecOf(entry: RpcSpec): RpcSpec {
    const spec: Record<string, unknown> = {}
    for (const key of RPC_SPEC_KEYS) {
        const value = entry[key]
        if (value !== undefined) spec[key] = value
    }
    return spec as unknown as RpcSpec
}

// THE SAME SHAPE AS A CONSUMER MUST ACCEPT IT. `rpcSpecs()` writes every policy field, but a
// hand-built proxy (a test, a fixture) omits them and lands on the normalizer's defaults — which is
// sound because `rpcMemoPolicy` is idempotent. Every field admits an explicit `undefined` so a full
// spec forwards VERBATIM: re-deriving a default at the boundary to satisfy `exactOptionalPropertyTypes`
// is precisely how the fourth copy of the policy grew.
export type RpcSpecInput = Pick<RpcSpec, 'method' | 'read'> & {
    [K in RpcSpecPolicyKey]?: RpcSpec[K] | undefined
}

export type RpcSpecPolicyKey = Exclude<keyof RpcSpec, 'method' | 'read'>

// Just the policy half, for `clientProxy`, which takes `method` positionally.
export type RpcSpecPolicyInput = { [K in RpcSpecPolicyKey]?: RpcSpec[K] | undefined }
