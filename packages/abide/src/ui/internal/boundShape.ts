// WHAT SHAPE IS A `bind:` TARGET? — the classification half of two-way binding, owned here so the two
// runtimes cannot answer it differently.
//
// A bound value arrives as one of three things: a writable state (a callable carrying `.set`), an
// explicit `{ get, set }` accessor, or a plain value. Each substrate then does its own thing with the
// answer — the client builds a read/write `Accessor` and attaches listeners, the server only ever
// READS, since there is no node to write back to — and that part is genuinely per-substrate.
//
// The classification is not. It was written out in both (`runtime.boundAccessor`,
// `serverRuntime.resolveBound`, whose comment claims it resolves "exactly as the client does") and the
// two had already drifted on the accessor arm: the client required `typeof set === 'function'`, the
// server accepted any `set !== 'undefined'`. So a `{ get, set: <not a function> }` was a live accessor
// during SSR and a plain value after hydrate. This is the same fix `bindTarget.ts` and
// `attributeDisposition.ts` already applied one layer up — classification shared, action per-substrate.

export type StateLikeBound = (() => unknown) & { set: (value: unknown) => void }

export interface AccessorBound {
    get: () => unknown
    set: (value: unknown) => void
}

export function isStateLikeBound(bound: unknown): bound is StateLikeBound {
    return typeof bound === 'function' && typeof (bound as { set?: unknown }).set === 'function'
}

export function isAccessorBound(bound: unknown): bound is AccessorBound {
    if (bound === null || typeof bound !== 'object') return false
    const object = bound as { get?: unknown; set?: unknown }
    return typeof object.get === 'function' && typeof object.set === 'function'
}
