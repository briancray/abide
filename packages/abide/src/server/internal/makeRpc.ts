// The abide RPC FACTORY — shared construction for the HTTP verb helpers (M2).
//
// A verb helper turns a plain handler `fn(args)` into an `Rpc`: an isomorphic callable the
// router mounts (via `__rpc` metadata) and that server/client code invokes directly.
//
// READS (GET/HEAD) wrap the handler in a `memo` so in-process calls cache, coalesce, and are
// reactive — `(args)` reactively peeks, `peek/pending/error/refresh/invalidate` mirror
// the memo surface. memo.ttl flows into the memo; the remaining options (schemas/clients/
// crossOrigin/maxBodySize/timeout/middleware) are carried untouched for the router to enforce.
// `memo: false` on a read means "don't retain" → the memo runs at ttl:0 (coalesce concurrent, never
// serve stale) while keeping the reactive surface.
//
// MUTATIONS (POST/PUT/PATCH/DELETE) route through a memo exactly like reads and expose the SAME
// surface (`MutationSurface` = `Rpc` for a value handler, `StreamRead` for a streaming one) — full
// symmetry: `peek`/`pending`/`refreshing`/`error`/`watch`/`refresh`/`invalidate`/`publish`/`snapshot`/
// `seed`/`raw`/`isError` and the streaming chunk probes all work. The ONLY differences are transport
// (method + args-in-body + the CSRF gate, enforced by the router off `__rpc.read`) and the default
// memo policy: a mutation defaults to `memo: { ttl: 0 }` (replayable-streams.md §1) — coalesce
// identical CONCURRENT in-flight calls, retain nothing after settle — where a read retains (ttl ∞).
// A non-shared mutation's slot is per-request, so ttl:0 is inert for the normal one-call-per-request
// case and preserves at-least-once across separate requests; cross-request dedup needs `crossRequest: true`.
// An author who WANTS a mutation cached sets `memo: { ttl }` and the whole surface reflects it. `memo:
// false` opts the bare CALL out of the memo (direct run, at-least-once) for a non-idempotent handler;
// the probe surface stays present but reads an empty slot. A `FormData` body always bypasses the memo
// (it can't be safely keyed — see §1).

import { envMs } from '../../shared/internal/envMs.ts'
import { isTypedError } from '../../shared/internal/isTypedError.ts'
import { memoOptionsFor } from '../../shared/internal/memoOptionsFor.ts'
import type {
    ReactiveStreamProbes,
    ReactiveValueProbes,
    UntrackedRead,
} from '../../shared/internal/reactiveReadSurface.ts'
import type { Payload } from '../../shared/internal/responseSource.ts'
import { type RpcMemoDeclaration, rpcMemoPolicy } from '../../shared/internal/rpcMemoPolicy.ts'
import type {
    MutationCallArgs,
    MutationInvokeArgs,
    RpcCallArgs,
    RpcCallOptions,
    RpcCallSurface,
    RpcInvokeArgs,
} from '../../shared/internal/rpcSurface.ts'
import { markSettled } from '../../shared/internal/settledRead.ts'
import { withAbort } from '../../shared/internal/withAbort.ts'
import { withDeadline } from '../../shared/internal/withDeadline.ts'
import { log } from '../../shared/log.ts'
import { type Memo, type MemoNotify, type MemoOptions, memo } from '../../shared/memo.ts'

export type { Payload } from '../../shared/internal/responseSource.ts'

import type { JSONSchema } from '../../shared/internal/jsonSchema.ts'
import type { StandardSchemaV1 } from '../../shared/StandardSchema.ts'
import type { CrossOriginOption } from './cors.ts'
import { encodeRpcValue } from './encodeRpcValue.ts'
import type { Middleware } from './middleware.ts'
import { outcomeResponse, timeoutResponse } from './outcomeResponse.ts'
import type { ClientsOption } from './registry.ts'

// A minimal, JSON-Schema-ish description of the file fields a multipart mutation accepts (TODO #8).
// `required` names the file fields that MUST be present as a `File`; `properties` optionally
// constrains a field's byte size (`maxSize`) and/or MIME type (`accept`, exact or `image/*`
// wildcard). Text fields ride in the same FormData but are described by the JSON `input` schema, not
// here — the router projects the multipart non-File fields and validates them against `input` (TODO
// #8 follow-up), while a `File` never rides in the JSON args object (decision TODO #8).
export interface FilesSchema {
    required?: string[]
    properties?: Record<string, { maxSize?: number; accept?: string | string[] }>
}

// M8b: input/output accept EITHER a Standard Schema (Zod/Valibot/etc.) OR a raw/derived JSON Schema;
// the router normalises whichever it gets via `asStandardSchema` before validating. `files`
// describes the multipart file fields (TODO #8) — validated by `validateFiles` on a multipart
// request; the JSON `input` schema governs the non-multipart JSON args path AND the multipart TEXT
// fields (projected via `projectFormText`, TODO #8 follow-up).
export interface RpcSchemas {
    input?: StandardSchemaV1 | JSONSchema
    output?: StandardSchemaV1 | JSONSchema
    files?: FilesSchema
}

export interface RpcOptions {
    schemas?: RpcSchemas
    // REACHABILITY only — which surfaces reach this rpc. NOT authorization (that is `middleware`).
    // Typed as of ADR 0027 D9; it was `unknown`, which is how two documented behaviours rotted here
    // unseen by both the compiler and a dead-field scan. See `registry.ts`'s `resolveClients`.
    clients?: ClientsOption
    // Optional human/machine description for the RPC, surfaced into the registry and every machine
    // surface (OpenAPI operation summary, MCP tool description, CLI --help). Schema-level
    // description/title still wins per MS1.2; this fills the gap when the schema carries none.
    doc?: string
    middleware?: Middleware[]
    crossOrigin?: CrossOriginOption
    maxBodySize?: number
    timeout?: number
    // `false` opts a call OUT of the memo entirely (replayable-streams.md §1): a mutation runs every call
    // (no coalescing); a read runs at ttl:0. `{ … }` overrides the per-verb default (reads ttl:∞,
    // mutations ttl:0).
    // `throttle`/`debounce` are the SWR refetch clock (rpc-core §3) and, like `ttl` and `tags`, they are
    // BILATERAL: carried to the browser proxy's memo too, so an author who rate-limits revalidation gets
    // it on both sides. That is where it earns most of its keep — a socket broadcast storm calling
    // `fn.refresh()` is a client-side stream of triggers.
    //
    // The declaration shape is the NORMALIZER's own input type (`shared/internal/rpcMemoPolicy`), not a
    // structural twin of it — one shape means a field added here is a field the normalizer sees, rather
    // than one it silently drops on the way to the wire.
    memo?: false | RpcMemoDeclaration
}

// An `output` schema, when present, must ACCEPT the handler's resolved return payload — its Standard
// Schema input type is pinned to `Payload<Awaited<R>>` so a drifted return (handler returns a shape the
// schema can't parse) is a compile error at the `output:` property. A raw JSON Schema stays unchecked
// (it carries no TS type). Reused by both overload opts shapes below.
type OutputSchemaFor<R> = StandardSchemaV1<Payload<Awaited<R>>, unknown> | JSONSchema

// Opts for the SCHEMA-FIRST overload: `schemas.input` is a Standard Schema `S`, and the handler's
// argument type flows FROM it (`InferOutput<S>`) — no annotation needed on the handler. `output` is
// pinned to the handler's return.
export type RpcOptionsWithInput<S extends StandardSchemaV1, R> = Omit<RpcOptions, 'schemas'> & {
    schemas: Omit<RpcSchemas, 'input' | 'output'> & { input: S; output?: OutputSchemaFor<R> }
}

// Opts for the PLAIN overload: no Standard-Schema input (Args comes from the handler param — an
// annotation, a generic, or a destructuring default), so `schemas.input` stays a raw/derived JSON
// Schema at most. `output` is pinned to the handler's return.
export type RpcOptionsWithOutput<R> = Omit<RpcOptions, 'schemas'> & {
    schemas?: Omit<RpcSchemas, 'input' | 'output'> & {
        input?: JSONSchema
        output?: OutputSchemaFor<R>
    }
}

// Router-facing metadata baked onto every Rpc/Mutation. `read` distinguishes cache-backed
// reads from direct-call mutations; `handler` is the untouched user function (schema
// validation and client gating wrap it later, at mount time).
export interface RpcMeta<Args, T> {
    method: string
    handler: (args: Args) => Promise<T> | T
    options: RpcOptions
    read: boolean
    // The RESOLVED run deadline in ms (ADR 0028), `0` when unbounded. Baked at construction rather than
    // recomputed per request so the env read and the unbounded-opt-out warning happen exactly once —
    // a per-request `resolveRpcTimeout` would re-emit that warning on every call to an unbounded rpc.
    timeout: number
}

// A read-call argument tuple. A ZERO-arg handler (`GET(() => …)`) infers `Args = unknown`, so the
// argument is OPTIONAL — a bare `fn()` / `fn.pending()` type-checks (the documented zero-arg read). A
// handler with a declared args type (`GET((a: { id: string }) => …)`) keeps `Args` concrete, so the
// argument stays REQUIRED. `unknown extends Args` is true only for `unknown`/`any`, false for any
// concrete shape — exactly the discriminator between "no declared input" and "declared input".
// The call surface itself lives in `shared/internal/rpcSurface.ts` (ADR 0027 D10) so the browser proxy
// can name it without importing `server/`; `Rpc` is that surface PLUS the server-only construction meta.
export type { MutationCallArgs, RpcCallArgs }

// How a chained read runs: the runner receives the args (which the chain needs to say WHICH read it is
// authorizing) and the un-chained producer, and returns the produced value — or throws, when a middleware
// short-circuited. Installed by `bindRpcChains`, which every boot calls.
export type RpcChainRunner<Args, T> = (args: Args, produce: () => Promise<T>) => Promise<T>

// THE SERVER-ONLY MEMBERS OF A ROUTE, declared once for both route surfaces.
//
// All three are `__`-prefixed, and for `__bare` that is load-bearing rather than cosmetic: it is the call
// that SKIPS the middleware chain — i.e. skips what `auth.md` calls auth. Spelled `bare`/`bindChain` they
// appeared in the autocomplete of anyone importing `$server/rpc/getUsers`, sitting between `peek` and
// `refresh` and reading exactly like a supported way to call an rpc. `__rpc` already established the
// convention for "this is the router's seam, not your API".
//
// Declared on ONE interface because the previous split was silent and wrong: `Rpc` carried the chain
// members and `StreamRead` did not, though `makeRead` builds both from the same `attachSurface` — so the
// router reached a streaming route's un-chained entry through a cast that was sound only by luck. One
// declaration, both surfaces, and `Route` (their union) has the members without a cast.
export interface ServerRouteMembers<Args, T> {
    readonly __rpc: RpcMeta<Args, T>
    // Install the middleware chain this rpc's reads run under. Called once per route per boot; binding
    // again REPLACES the runner, so a dev-server rebuild cannot nest two chains on one route.
    __bindChain(runner: RpcChainRunner<Args, T>): void
    // The memo call with NO chain — for the router, which composes the chain around all of dispatch.
    __bare(args: Args): Promise<T>
}

// The isomorphic call surface (probes, verbs, hydration seams) plus the members that are genuinely
// server-side. The browser proxy implements everything in `RpcCallSurface` and none of `ServerRouteMembers`,
// which is exactly where this line is drawn.
export interface Rpc<Args, T> extends RpcCallSurface<Args, T>, ServerRouteMembers<Args, T> {}

// A STREAMING read — a handler that yields an `AsyncIterable<C>` (replayable-streams.md §4). The read
// resolves to a fresh replay-then-live `consume()` cursor, and the surface is stream-correct: reactive
// chunk reads and probes (`live`/`chunks`/`done`/`streaming`) instead of the value-shaped
// `publish`/`snapshot`, which are meaningless (or throw) on a stream slot. This is what a user's editor
// sees for a streaming read.
// BOTH probe halves plus the untracked read, inherited at the RPC arity: a stream has a latest value AND
// a transcript. The
// names were hand-copied here and this interface extended nothing — and the copy had already drifted,
// silently omitting `refreshing` while `RpcCallSurface` next door declared it, for no stated reason.
// `live`/`peek` mean the MOST-RECENT CHUNK here (same names and roles as a value read's, over `C` rather
// than `T`), which is exactly what parameterizing the surfaces by their value type buys.
export interface StreamRead<Args, C>
    extends UntrackedRead<C, RpcCallArgs<Args>>,
        ReactiveValueProbes<C, RpcCallArgs<Args>>,
        ReactiveStreamProbes<C, RpcCallArgs<Args>>,
        ServerRouteMembers<Args, AsyncIterable<C>> {
    // THE READ: awaitable; resolves to a fresh cursor that replays the transcript so far then goes live.
    (...args: RpcInvokeArgs<Args>): Promise<AsyncIterable<C>>
    // Re-run the source; `invalidate` aborts an open stream + drops it (replayable-streams.md §4).
    refresh(args?: Partial<Args> | Args): void
    invalidate(args?: Partial<Args> | Args): void
    // The bare call, encoded: this caller's own replay-then-live cursor served as jsonl/sse (the
    // handler's tagged choice first, then `init`'s `Accept`) over the ONE run the slot holds.
    raw(args: Args, init?: RequestInit): Promise<Response>
    isError(e: unknown, name: string): boolean
}

// The surface a read helper (GET/HEAD) yields. A handler may return its result RAW or wrapped in a
// transport helper; both resolve to the same thing (replayable-streams.md §4), so we unwrap the brand
// first via `Payload<R>`, then choose StreamRead (iterable) vs Rpc (value). The `[…]` tuple wraps make
// the conditionals non-distributive over a union return type.
export type ReadSurface<Args, R> = [Payload<R>] extends [AsyncIterable<infer C>]
    ? StreamRead<Args, C>
    : Rpc<Args, Payload<R>>

// A value MUTATION shares the FULL `Rpc` surface (peek/pending/refreshing/refresh/invalidate/publish/
// watch/snapshot/seed/raw/isError/…) — full symmetry with a read. It only widens the CALL to also
// accept a `FormData` body (TODO #8 multipart upload), which bypasses the memo; a zero-arg mutation
// keeps the argument optional. The `.raw` here still carries the mutation body + CSRF header on the
// client and returns the untouched `Response` (no parse, no `!ok` throw).
export interface Mutation<Args, T> extends Rpc<Args, T> {
    (...args: MutationInvokeArgs<Args>): Promise<T>
}

// A streaming MUTATION shares the full `StreamRead` chunk-probe surface (peek=latest chunk / chunks /
// done / pending / error / refresh / invalidate / raw); only the call widens to accept `FormData`.
export interface StreamMutation<Args, C> extends StreamRead<Args, C> {
    (...args: MutationInvokeArgs<Args>): Promise<AsyncIterable<C>>
}

// The surface a mutation helper (POST/PUT/PATCH/DELETE) yields — the read-side `ReadSurface`, widened
// to accept a `FormData` call. A streaming handler gets `StreamMutation`, a value handler `Mutation`.
export type MutationSurface<Args, R> = [Payload<R>] extends [AsyncIterable<infer C>]
    ? StreamMutation<Args, C>
    : Mutation<Args, Payload<R>>

// The RPC read contract is `Promise<T>` on BOTH sides, whatever the backing memo does. A zero-arg
// synchronous handler makes that memo auto-tracked (ADR 0024 §3), so its bare read is the value itself and
// a throwing handler throws where a promise would reject — normalise both here. The resolved promise is
// tagged settled so attach-hydration still claims the server-rendered `{#await fn()}` branch rather than
// re-mounting it.
function settleRead<T>(read: () => Promise<T> | T): Promise<T> {
    let value: Promise<T> | T
    try {
        value = read()
    } catch (caught) {
        return Promise.reject(caught)
    }
    if (value !== null && typeof value === 'object' && 'then' in value) return value as Promise<T>
    return markSettled(Promise.resolve(value as T), value as T)
}

function attachMeta<Args, T>(target: object, meta: RpcMeta<Args, T>): void {
    Object.defineProperty(target, '__rpc', { value: meta, enumerable: false })
}

// Attach the FULL isomorphic surface (reactive probes + cache verbs + `raw` + stream chunk probes +
// `__rpc` meta) to a memo-backed callable. Shared by reads and mutations — the only caller-specific
// pieces are the bare CALL (built by the caller, so a mutation can bypass on FormData/`memo:false`)
// and the meta `read` flag. `handler` is the meta handler (the same function reference the
// router/OpenAPI/MCP invoke); `chained` is the CALL — chain + memo + deadline — which is what `.raw`
// runs, since `.raw` differs from `fn(args)` in nothing but its return type.
function attachSurface<Args, T>(
    callable: Rpc<Args, T>,
    backing: Memo<Args, T>,
    handler: (args: Args) => Promise<T> | T,
    method: string,
    options: RpcOptions,
    read: boolean,
    timeout: number,
    setBroadcast: (sink: MemoNotify) => void,
    setChain: (runner: RpcChainRunner<Args, T>) => void,
    bare: (args: Args) => Promise<T>,
    chained: (args: Args, callOptions?: RpcCallOptions) => Promise<T>,
): void {
    callable.__bindChain = setChain
    // The call WITHOUT the middleware chain — what the ROUTER invokes, because it composes the chain itself
    // around the whole of dispatch (so arg decoding and `schemas.input` validation happen INSIDE
    // authorization, where a 422 must not precede a 403). Every other caller goes through the chained call.
    // Two entry points over one producer is what keeps the chain running exactly once per read whichever
    // door it came through.
    //
    // It is the FACTORY's producer, handed in rather than rebuilt from the memo here — a mutation's producer
    // is not simply "call the memo". A `FormData` body bypasses the memo entirely (a raw FormData throws in
    // `canonicalKey`), as does `memo: false`, and rebuilding this as a bare memo call silently routed every
    // multipart upload through the memo instead.
    callable.__bare = bare
    callable.live = (args: Args): T | undefined => backing.live(args)
    callable.peek = (args: Args): T | undefined => backing.peek(args)
    callable.pending = (args: Args): boolean => backing.pending(args)
    callable.refreshing = (args: Args): boolean => backing.refreshing(args)
    callable.settled = (args: Args): boolean => backing.settled(args)
    callable.error = (args: Args): unknown => backing.error(args)
    callable.watch = (args: Args, handler: (value: T | undefined) => void): (() => void) =>
        backing.watch(args, handler)
    // `.raw` IS THE BARE CALL, ENCODED. One difference from `fn(args)` and it is the return type: a
    // `Response` instead of the decoded value. Everything else about the read is the same read — the
    // middleware chain, the memo (coalesce + retain), the run deadline, the reactive slot it fills.
    //
    // It used to call `rawSource` — the handler — which made it the one read surface that was neither
    // coalesced nor AUTHORIZED, and `auth.md` had to carve out an exception for it. That exception was
    // load-bearing in the wrong direction: `middleware` is tracing, rate limiting and context population
    // as well as auth, so `.raw` was a door that ran none of it, and the deadline ADR 0028 D6 claims for
    // `.raw` was never armed on this side either (the handler was awaited bare). Nothing about wanting
    // the RESPONSE says anything about wanting to skip the read's own contract.
    //
    // What that costs, stated rather than discovered: a handler's `json(data, { status, headers })` is
    // seen through by the memo to `data` (`responseSource.ts`), so its init no longer survives to here.
    // `.raw` answers what the WIRE would answer for this read, through the ROUTER'S OWN encoder
    // (`encodeRpcValue`) rather than a second copy of it — which is what makes that sentence checkable
    // instead of aspirational. An UNTAGGED `Response` a handler returns is still the memo's value, so it
    // passes through whole.
    callable.raw = async (args: Args, init?: RequestInit): Promise<Response> => {
        let value: T
        try {
            // `init.signal` is the CALLER's wait, forwarded exactly as the bare call takes it (ADR 0028
            // D3): it detaches this waiter and leaves the run to the other callers coalesced on the slot.
            value = await chained(args, init?.signal == null ? undefined : { signal: init.signal })
        } catch (caught) {
            // `.raw` is the RESPONSE surface, so a deliberate `error()`/`redirect()` is rendered rather
            // than rethrown — matching the browser proxy's `.raw`, which hands back a non-2xx untouched
            // (no parse, no `!ok` throw). An unexpected error still propagates; only transport turns a
            // genuine bug into a 500, and doing it here would disguise one as a normal response.
            //
            // The same two rungs, in the same order, as the router's `handleUncaught` — a tripped run
            // deadline is neither deliberate nor a bug, and it is now REACHABLE here: `.raw` had no
            // deadline at all while it called the handler directly (ADR 0028 D6 said otherwise).
            const outcome = outcomeResponse(caught) ?? timeoutResponse(caught)
            if (outcome === undefined) throw caught
            return outcome
        }
        return encodeRpcValue(value, acceptOf(init))
    }
    callable.isError = isTypedError
    callable.refresh = (args?: Partial<Args> | Args): void => backing.refresh(args)
    callable.invalidate = (args?: Partial<Args> | Args): void => backing.invalidate(args)
    callable.publish = (args: Args, next: T | ((current: T | undefined) => T)): void =>
        backing.publish(args, next)
    callable.snapshot = (): Array<{ args: Args; value: T }> => backing.snapshot()
    callable.seed = (args: Args, value: T): void => backing.seed(args, value)
    callable.seedStream = (
        args: Args,
        source: readonly unknown[] | AsyncIterable<unknown>,
        encoding?: 'jsonl' | 'sse',
    ): void => backing.seedStream(args, source, encoding)
    callable.bindBroadcast = (sink: MemoNotify): void => setBroadcast(sink)
    // Stream probes live on the runtime object for ALL routes (they return undefined/false for a value
    // slot); only the StreamRead/StreamMutation type surfaces them. `peek` is already stream-aware, and so
    // is `settled` above — which is why it sits with the VALUE probes rather than here: every route has a
    // terminal to report, and only its shape (value/error vs transcript-ended) is cardinality-dependent.
    const streamable = callable as Rpc<Args, T> & {
        chunks(args: Args): unknown[] | undefined
        done(args: Args): boolean
        streaming(args: Args): boolean
        resumeStream(
            args: Args,
            from: number,
        ): { cursor: AsyncIterable<unknown> | undefined; fresh: boolean }
    }
    streamable.chunks = (args: Args): unknown[] | undefined => backing.chunks(args)
    streamable.done = (args: Args): boolean => backing.done(args)
    streamable.streaming = (args: Args): boolean => backing.streaming(args)
    streamable.resumeStream = (args: Args, from: number) => backing.resumeStream(args, from)
    attachMeta(callable, { method, handler, options, read, timeout })
}

// `.raw`'s `init` describes the REQUEST this in-process read stands in for, so its `Accept` selects the
// stream encoding exactly as an HTTP caller's does. (It used to be spread onto the RESPONSE init — a
// `RequestInit` where a `ResponseInit` was wanted, so the only fields that could land were the ones the
// two happen to share by name.) `HeadersInit` is three shapes; `Headers` normalizes all of them.
function acceptOf(init: RequestInit | undefined): string | null {
    if (init?.headers === undefined) return null
    return new Headers(init.headers).get('accept')
}

// The run deadline for this rpc in ms (ADR 0028 D9). `ABIDE_RPC_TIMEOUT` is a FALLBACK CEILING, not a
// tuned bound — the per-rpc `timeout` is the real knob, and a caller wanting a tight one arms its own
// (`fn(args, { signal: AbortSignal.timeout(500) })`, D3). It cannot default to unbounded: SSR exempts an
// abide `{#for await}` source from the global `ABIDE_SSR_STREAM_BUDGET` on the strength of THIS deadline
// (`streamScheduler.ts`), so an infinite default would ship that exemption with nothing behind it.
//
// `0`/`Infinity` is a legal opt-out and is LOUD, in the manner of `deriveSchema`'s `any`-param warning:
// an unbounded rpc re-opens that exemption for itself, and a silently unbounded stream is precisely the
// hole this option was added to close.
function resolveRpcTimeout(options: RpcOptions, method: string): number {
    const declared = options.timeout
    if (declared === undefined) return envMs('ABIDE_RPC_TIMEOUT', DEFAULT_RPC_TIMEOUT_MS)
    if (!Number.isFinite(declared) || declared <= 0) {
        log.channel('abide:rpc').warn(
            `${method} declares timeout: ${String(declared)} — this rpc runs UNBOUNDED. Its SSR ` +
                `{#for await} exemption from ABIDE_SSR_STREAM_BUDGET now has nothing behind it, so a ` +
                `hung run holds the document open. Set a finite timeout unless that is intended.`,
        )
        return 0
    }
    return declared
}

const DEFAULT_RPC_TIMEOUT_MS = 300_000

// THE MEMO ASSEMBLY, ONCE — what a read and a mutation both are before transport.
//
// `rpc = memo + transport`, and the memo half was written out twice: the same eight decisions in the same
// order (policy → memo options → `crossRequest` → `loader` → deadline → `notify` → build → chain), with
// the copy-pasted comments to prove it ("Server-only, as in `makeRead` above"; the loader note verbatim).
// `attachSurface` then took ten positional arguments, two of which were single-use setter closures spelled
// identically in both factories — a shallow seam where an eleventh capability means editing four sites.
//
// THE GENUINE DIFFERENCES ARE THREE, and they are the parameters: which verb the policy is normalised for,
// the `read` flag on the meta, and the PRODUCER. That last one is why this is not a merge of the verbs:
// ADR 0030 D2 records that `__bare` must be handed in by the factory rather than rebuilt from the memo,
// because a mutation's producer is not "call the memo" (a `FormData` body and `memo: false` both bypass it,
// and rebuilding that branch routed every multipart upload through the memo). So the producer is BUILT by
// the caller, from what the assembly resolved — and gets exactly the three things it can need.
interface RpcAssembly<Args, T> {
    method: string
    // The handler as the memo sees it: a mutation's `fn` returns the transport-wrapped `R` and the memo
    // sees through to the payload, so the cast happens at the call site where both types are known.
    handler: (args: Args) => Promise<T> | T
    options: RpcOptions
    read: boolean
    produce: (resolved: {
        backing: Memo<Args, T>
        timeout: number
        policy: ReturnType<typeof rpcMemoPolicy>
    }) => (args: Args) => Promise<T>
}

function assembleRpc<Args, T>(assembly: RpcAssembly<Args, T>): Rpc<Args, T> {
    const { method, handler, options, read } = assembly
    // ONE normalizer decides the policy (`shared/internal/rpcMemoPolicy`) and ONE builder turns it into
    // memo options — the same pair the wire spec and the browser proxy read, so a read's server memo and
    // its client memo cannot disagree. `memo: false` on a read = retain nothing → ttl:0 (coalesce-only,
    // always revalidate) while keeping the reactive surface; the full bare-call bypass is the mutation's
    // opt-out. Setting both refetch-clock edges is a TypeError from the memo constructor below, which
    // surfaces at module load with the route's own stack, so there is no second validation here.
    const policy = rpcMemoPolicy(options.memo, read)
    const memoOptions: MemoOptions = memoOptionsFor(policy)
    // The SERVER-only half of the policy: which store the slot lives in. `memoOptionsFor` withholds it by
    // design, because a browser has no request to cross and a `crossRequest` memo fails closed outside a
    // request scope.
    if (policy.crossRequest) memoOptions.crossRequest = true
    // An rpc handler is a LOADER, not a derivation — an async body is its expected shape, so suppress the
    // auto-tracking diagnostic (ADR 0027 D8) that would otherwise fire on every zero-arg rpc.
    memoOptions.loader = true
    // The deadline is the MEMO's (ADR 0028 D2): the memo owns the run, so one coalesced slot has one
    // deadline and every joined caller observes the identical outcome.
    const timeout = resolveRpcTimeout(options, method)
    memoOptions.timeout = timeout
    // Late-bound broadcast target: the memo gets a stable, transport-free sink now; `createApp` sets the
    // actual publish target via `bindBroadcast` once the route name is known. Unbound → no-op.
    let broadcast: MemoNotify | undefined
    memoOptions.notify = (verb, args, value): void => {
        if (broadcast !== undefined) broadcast(verb, args, value)
    }
    const backing = memo<Args, T>(handler, memoOptions)

    // The middleware chain this callable runs under, installed by `bindRpcChains` (the only place the
    // route's own NAME is known — the chain needs it to say which read it is authorizing). Unbound — a
    // hand-built rpc with no app around it — is a direct memo call, which is what keeps `makeRpc`
    // transport-free and unit-testable on its own.
    let chain: RpcChainRunner<Args, T> | undefined
    const produce = assembly.produce({ backing, timeout, policy })

    // A caller's `signal` detaches THEIR wait and leaves the run alone (ADR 0028 D3) — the run belongs to
    // the memo slot, which other callers are coalesced onto.
    //
    // The chain wraps the CALL, not the memo body. `middleware` is `(next) => Response` — tracing, rate
    // limiting, context population, auth — so it is part of what a READ means and runs per read, from any
    // door. It cannot wrap the body: a memo coalesces by ARGS, so two principals reading the same args
    // share one run, and a chain inside would let the first caller's authorization stand in for the
    // second's.
    const call = (args: Args, callOptions?: RpcCallOptions): Promise<T> =>
        withAbort(
            chain === undefined ? produce(args) : chain(args, () => produce(args)),
            callOptions?.signal,
        )
    const callable = call as unknown as Rpc<Args, T>

    attachSurface(
        callable,
        backing,
        handler,
        method,
        options,
        read,
        timeout,
        (sink) => {
            broadcast = sink
        },
        (runner) => {
            chain = runner
        },
        produce,
        call,
    )
    return callable
}

export function makeRead<Args, T>(
    method: string,
    fn: (args: Args) => Promise<T> | T,
    opts?: RpcOptions,
): Rpc<Args, T> {
    return assembleRpc<Args, T>({
        method,
        handler: fn,
        options: opts ?? {},
        read: true,
        // A read's producer IS "call the memo" — the whole point of the read path. `settleRead` is what
        // turns the memo's `T | Promise<T>` into the awaitable the surface promises.
        produce:
            ({ backing }) =>
            (args) =>
                settleRead(() => backing(args)),
    })
}

export function makeMutation<Args, R>(
    method: string,
    fn: (args: Args) => Promise<R> | R,
    opts?: RpcOptions,
): MutationSurface<Args, R> {
    type T = Payload<R>

    // `fn` returns the (possibly transport-wrapped) `R`; the memo sees through it to the payload `T`.
    const handler = fn as unknown as (args: Args) => Promise<T> | T

    // A mutation is a memo + transport exactly like a read — the memo backs BOTH the coalescing call and
    // the whole probe surface. It differs only in the DEFAULT policy: ttl:0 (coalesce identical concurrent
    // in-flight calls, retain nothing) where a read retains. `memo: { ttl }` opts a mutation into retention
    // and the surface reflects it. `memo: false` still builds a memo so the surface exists (probes read an
    // empty slot), but the bare CALL bypasses it for a direct at-least-once run — which is the one place
    // the policy is verb-dependent, so `rpcMemoPolicy` is told which verb it is and returns `memoed`
    // rather than each side re-reading `options.memo !== false`.
    //
    // The refetch clock is forwarded even at ttl:0, where it cannot bite (nothing retained to revalidate):
    // the option pairing is the author's, and dropping it on the verb that happens to default to 0 is the
    // surface asymmetry `ttl`/`tags` are already carried across to avoid.
    const mutation = assembleRpc<Args, T>({
        method,
        handler,
        options: opts ?? {},
        read: false,
        // A FormData/multipart body can't be safely keyed (files have no cheap canonical value; a raw
        // FormData throws in `canonicalKey`), and `memo: false` opts the call out entirely → run the
        // handler directly (at-least-once). Otherwise route through the memo (coalesce/retain).
        //
        // Built ONCE here and used for both doors, so `__bare` IS this function: the router's door and the
        // chained door must differ in the chain and in NOTHING else, and a second copy of this branch is
        // how the multipart bypass came to exist on only one of them.
        produce:
            ({ backing, timeout, policy }) =>
            (args) =>
                !policy.memoed ||
                (typeof FormData !== 'undefined' && (args as unknown) instanceof FormData)
                    ? // The memo-bypass path still gets its deadline (ADR 0028): with no slot there is
                      // nothing else left to bound it.
                      Promise.resolve(withDeadline(handler(args), timeout))
                    : settleRead(() => backing(args)),
    })
    return mutation as unknown as MutationSurface<Args, R>
}
