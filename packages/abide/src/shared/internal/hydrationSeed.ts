// The SSR→client HANDOFF CONTRACT (ADR 0026 layering; ADR 0027 D10). These three types describe the
// wire payload the server paints into the document and the client reads back on hydrate — so they are
// by definition about BOTH sides, and living in `server/internal/` made `ui/` uncompilable without
// `server/`. They are pure data shapes with no dependencies, which is what makes `shared/` the right
// floor for them: the server WRITES the seed (`server/internal/pages.ts`), the client READS it
// (`ui/internal/bootstrap.ts`, `seededState.ts`, `navigate.ts`), and neither owns it.

// One recorded SSR read for the hydration seed: the RPC route name, the args it was called with, and
// the (output-shaped) value it resolved to.
export interface SeedRead {
    name: string
    args: unknown
    value: unknown
}

// One attachable `{#for await}` stream handed off to the client (replayable-streams.md §5).
// `name`/`args` identify the source RPC for a mode-B resume (`GET /__abide/rpc/<name>?__abide_args=…&
// __abide_from=<count>`, where the count is `values.length`); `done` picks the mode (true → adopt
// `values`, false → resume); `values` is the decoded transcript so mode A re-mounts with zero network.
// `values` is absent only if it wasn't JSON-serializable.
export interface StreamHandle {
    name: string | null
    args: unknown
    done: boolean
    values?: unknown[]
}

// The hydration seed payload. Empty (`{}`) when the page resolved no reads and declared no state.
export interface HydrationSeed {
    reads?: SeedRead[]
    // Recorded `state(initial)` initials, grouped per component in call order, so the client seeds each
    // memo with the same value the server rendered (decision 10). Present only when the page declared
    // state. These are hydrated NON-RPC values, so — unlike the JSON-only RPC `reads`/`streams` — the
    // whole `unknown[][]` bucket structure is serialized with the rich value codec (`encode`), preserving
    // Date/Map/Set/BigInt/TypedArray and shared/circular references across the record. The field holds
    // that one `encode(...)` string; the client `decode`s it. A codec-unsupported initial (function/
    // symbol/class instance) is encoded as `null` rather than crashing the render (lossy mode).
    states?: string
    // Attachable `{#for await}` handoff records (§5). Present only when the page streamed a known-RPC
    // source; the client adopts/resumes each instead of re-invoking the source on hydrate.
    streams?: StreamHandle[]
    // CO2.3: the `traceparent` of the request that rendered this page, so the client can ADOPT it and
    // `trace()` answers in the browser. It rides the seed because a first-load DOCUMENT response's
    // headers are not readable from JS — the `traceresponse` header the same response carries is only
    // reachable to a `fetch` caller (which is how a param/query nav, seedless by design, picks it up).
    trace?: string
}
