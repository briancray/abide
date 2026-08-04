// The SSR→client HANDOFF CONTRACT (ADR 0026 layering; ADR 0027 D10). These types describe the wire
// payload the server paints into the document and the client reads back on hydrate — so they are by
// definition about BOTH sides, and living in `server/internal/` made `ui/` uncompilable without
// `server/`. They are pure data shapes with no dependencies, which is what makes `shared/` the right
// floor for them: the server WRITES the seed (`server/internal/pages.ts`), the client READS it
// (`ui/internal/bootstrap.ts`, `seededState.ts`, `navigate.ts`), and neither owns it.
//
// The wire payload is the first half; `HydrationSeedSurface` at the bottom is the second — the three
// members a warm slot is INSTALLED through, which is the same contract seen from the type side.

import type { Principal } from './principal.ts'

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
    // AU3 / the isomorphic `identity()`: the principal the SERVER resolved for the request that rendered
    // this page, so the browser can answer `identity()` without a round trip and without reading the
    // HttpOnly cookie (it cannot). Plain JSON rather than the rich codec — a principal round-trips
    // through the sealed cookie as JSON already, so anything richer would not have survived to get here.
    //
    // This makes a rendered document identity-bearing, which is exactly what the router's default
    // `Cache-Control: private, no-cache` + `Vary: Cookie` on documents already assumes; a page that
    // opts into `public` caching is warned about on the cookie path for the same reason.
    identity?: Principal
}

// A mode-B (OPEN) SSR handoff: the flushed `prefix` is already known, `rest` resumes the tail over the
// wire. Kept as its own shape rather than one pre-concatenated generator so `startStream` can push the
// prefix SYNCHRONOUSLY — attach-hydration reads the transcript in the SAME TICK to bind each painted
// item's value and claim the server's nodes, and a generator's first yield is already a microtask late.
export interface StreamSeed {
    prefix: readonly unknown[]
    rest: AsyncIterable<unknown>
}

// What `seedStream` accepts, as ONE name: a completed (mode-A) array transcript, the mode-B
// prefix-plus-resumed-tail pair, or any other warm source (which closes the slot when it ends).
//
// A name rather than the union respelled per site, because respelling it per site is exactly how
// `StreamSeed` fell out of three of the four copies — see `HydrationSeedSurface` below.
export type StreamSeedSource = readonly unknown[] | AsyncIterable<unknown> | StreamSeed

// The §5 seed surface — `snapshot`/`seed`/`seedStream`, declared once.
//
// `Memo` and `RpcCallSurface` both carry these three and both used to declare them by hand, with the
// prose "mirrors `Memo`" standing in for the connection. That is the rot ADR 0027 D4 removed from the
// PROBE vocabulary (`ReactiveValueProbes`) surviving one level up on the verbs — and unlike the probes
// it had already drifted, on the member that matters most:
//
//   `Memo.seedStream` accepted `StreamSeed`; `RpcCallSurface.seedStream` did not, and `makeRpc` +
//   `clientProxy` each re-typed the narrow union and forwarded. The single mode-B production caller
//   (`ui/internal/bootstrap.ts`) type-checked only because it cast the proxy to a locally hand-written
//   `{ seedStream?: (args: unknown, source: unknown) => void }` — an `unknown` that erased the union
//   outright. So the open-stream handoff `StreamSeed` exists for was invisible to the type system end
//   to end: adding a required field to `StreamSeed` broke nothing at compile time. `memo`'s own
//   implementation had drifted the same way and compiled because a method-style declaration is
//   bivariant in its parameters.
//
// Arity is NOT a parameter here, unlike `ReactiveValueProbes`. All three members take the key
// explicitly (`args: Args`) on both surfaces — none is a `Room` positional, none collapses for a void
// key — so there is nothing for the two spellings to disagree about.
export interface HydrationSeedSurface<Args, T> {
    // Every resolved slot in the active context — the SSR record source for the hydration seed
    // (rpc-core §5). Only `value`-state slots are reported; pending/error/idle are skipped.
    snapshot(): Array<{ args: Args; value: T }>
    // Replay a recorded (args, value) into the cache as a settled `value` slot, so a matching read
    // resolves from cache instead of re-loading — the client half of §5 hydration seeding.
    seed(args: Args, value: T): void
    // The STREAMING analog of `seed` (§5): install a warm stream slot from an SSR handoff so a hydrate
    // read replays it with NO client re-invoke, and `peek`/`chunks`/`done`/`refresh` reflect it.
    seedStream(args: Args, source: StreamSeedSource, encoding?: 'jsonl' | 'sse'): void
}
