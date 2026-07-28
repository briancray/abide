// The ONE derivation of an rpc's memo policy from its authored `memo` option (rpc-core §2/§3).
//
// Three surfaces need this policy and all three used to derive it themselves: the SERVER memo
// (`makeRpc`), the WIRE spec the browser reads (`registry`), and the BROWSER memo (`clientProxy`).
// They disagreed, in exactly the way ADR 0027 is about — a rule stated in prose ("`memo: false` opts
// a call OUT of the memo entirely; every call runs") and enforced three times independently:
//
//   `GET(fn, { memo: false })` ran at `ttl: 0` on the server (retain nothing, every observation
//   loads) and at `ttl: Infinity` in the browser (the wire carried `ttl: null` for a read, and the
//   proxy's own defaulting read that as "unset" → the memo default). The bare call bypassed on the
//   client either way, but `peek`/`pending`/`watch` route through the BACKING memo on both sides —
//   so the read that was declared uncacheable cached forever in the browser and never on the server.
//
// The policy is JSON-serializable BY CONSTRUCTION: it IS the wire spec, so the browser reads the
// server's answer instead of recomputing one. `ttl: null` is the JSON spelling of Infinity.
//
// And the function is IDEMPOTENT: feeding its own output back in (which is what the browser does with
// the wire spec) yields the same policy. That is what makes "the client re-normalizes" safe, and it is
// why `ttl` accepts `null` on the way in as well as out.

// The authored option, as `RpcOptions['memo']` spells it — plus `null` on `ttl`, the wire's Infinity.
export interface RpcMemoDeclaration {
    ttl?: number | null | undefined
    crossRequest?: boolean | undefined
    tags?: string[] | undefined
    throttle?: number | undefined
    debounce?: number | undefined
}

export interface RpcMemoPolicy {
    // Does the bare CALL route through the memo? The two verbs answer differently under `memo: false`,
    // and that asymmetry is the documented one (`RpcOptions.memo`): a MUTATION bypasses (direct run,
    // at-least-once, no coalescing of concurrent duplicates — the point of opting a non-idempotent
    // handler out), while a READ still routes through at `ttl: 0` (never serve stale, but coalesce
    // identical concurrent calls, which for an idempotent read costs nothing and saves a stampede).
    memoed: boolean
    // Retained-value window in ms; `null` = Infinity (retain until invalidate), because JSON cannot
    // carry Infinity and this shape travels to the browser verbatim.
    ttl: number | null
    crossRequest: boolean
    // Normalized to `undefined` when the author declared none or an empty list, so the two sides
    // register the identical tag set and the common spec stays a field lighter in the bundle.
    tags: string[] | undefined
    throttle: number | undefined
    debounce: number | undefined
}

export function rpcMemoPolicy(
    option: false | RpcMemoDeclaration | undefined,
    read: boolean,
): RpcMemoPolicy {
    // `memo: false` retains NOTHING on either side (ttl 0). This is the reading `CLAUDE.md` states —
    // "every call runs" — applied to the whole surface rather than to the bare call alone: a probe that
    // served a permanently-retained value would be a memo by another name on a callable that declared
    // it had none.
    if (option === false) {
        return {
            memoed: read,
            ttl: 0,
            crossRequest: false,
            tags: undefined,
            throttle: undefined,
            debounce: undefined,
        }
    }
    const tags = option?.tags
    return {
        memoed: true,
        // The per-verb default: a read retains until invalidated (∞ → null), a mutation coalesces
        // identical concurrent in-flight calls and retains nothing (0).
        ttl: option?.ttl ?? (read ? null : 0),
        crossRequest: option?.crossRequest === true,
        tags: tags !== undefined && tags.length > 0 ? tags : undefined,
        throttle: option?.throttle,
        debounce: option?.debounce,
    }
}
