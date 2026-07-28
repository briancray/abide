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
import type { Payload } from '../../shared/internal/responseSource.ts'
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
import type { Middleware } from './middleware.ts'
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
    memo?: false | { ttl?: number; crossRequest?: boolean; tags?: string[] }
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

// The isomorphic call surface (probes, verbs, hydration seams) plus the ONE member that is genuinely
// server-side: the construction meta the router reads. The browser proxy implements everything in
// `RpcCallSurface` and has no `__rpc`, which is exactly where this line is drawn.
export interface Rpc<Args, T> extends RpcCallSurface<Args, T> {
    readonly __rpc: RpcMeta<Args, T>
}

// A STREAMING read — a handler that yields an `AsyncIterable<C>` (replayable-streams.md §4). The read
// resolves to a fresh replay-then-live `consume()` cursor, and the surface is stream-correct: reactive
// chunk probes (`latest`/`chunks`/`done`) instead of the value-shaped `peek`/`publish`/`snapshot`, which
// are meaningless (or throw) on a stream slot. This is what a user's editor sees for a streaming read.
export interface StreamRead<Args, C> {
    // THE READ: awaitable; resolves to a fresh cursor that replays the transcript so far then goes live.
    (...args: RpcInvokeArgs<Args>): Promise<AsyncIterable<C>>
    // Reactive PEEK: the "current value" of a stream = its MOST-RECENT chunk (undefined before the first).
    // The non-blocking "latest value" read — same name/role as a value read's `peek`. Use `chunks` for all.
    peek(...args: RpcCallArgs<Args>): C | undefined
    // Reactive snapshot (copy) of the whole transcript so far; undefined until the stream starts.
    chunks(...args: RpcCallArgs<Args>): C[] | undefined
    // Source started but no chunk yet. Reactive.
    pending(...args: RpcCallArgs<Args>): boolean
    // The stream has closed (settled successfully). Reactive.
    done(...args: RpcCallArgs<Args>): boolean
    // Terminal error (read off the stream) or undefined. Reactive.
    error(...args: RpcCallArgs<Args>): unknown
    // Re-run the source; `invalidate` aborts an open stream + drops it (replayable-streams.md §4).
    refresh(args?: Partial<Args> | Args): void
    invalidate(args?: Partial<Args> | Args): void
    // Raw `Response`, full bypass (single-consumption stream body; no replay).
    raw(args: Args, init?: RequestInit): Promise<Response>
    isError(e: unknown, name: string): boolean
    readonly __rpc: RpcMeta<Args, AsyncIterable<C>>
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

// Narrow a caught value to a typed error by name — used by `fn.isError(e, name)`. A typed error
// (`error.typed(name, …)`) carries its name as `kind` (client HttpError-like) or `name` (server
// HttpError). Isomorphic: the same predicate works for a server-thrown error and a client-fetched one.
export function isTypedError(e: unknown, name: string): boolean {
    if (e === null || typeof e !== 'object') return false
    const record = e as Record<string, unknown>
    return record.kind === name || record.name === name
}

// Attach the FULL isomorphic surface (reactive probes + cache verbs + `raw` + stream chunk probes +
// `__rpc` meta) to a memo-backed callable. Shared by reads and mutations — the only caller-specific
// pieces are the bare CALL (built by the caller, so a mutation can bypass on FormData/`memo:false`)
// and the meta `read` flag. `rawSource` is the handler `.raw` runs in-process AND the meta handler
// (the same function reference the router/OpenAPI/MCP invoke).
function attachSurface<Args, T>(
    callable: Rpc<Args, T>,
    backing: Memo<Args, T>,
    rawSource: (args: Args) => Promise<T> | T,
    method: string,
    options: RpcOptions,
    read: boolean,
    timeout: number,
    setBroadcast: (sink: MemoNotify) => void,
): void {
    callable.peek = (args: Args): T | undefined => backing.peek(args)
    callable.pending = (args: Args): boolean => backing.pending(args)
    callable.refreshing = (args: Args): boolean => backing.refreshing(args)
    callable.error = (args: Args): unknown => backing.error(args)
    callable.watch = (args: Args, handler: (value: T | undefined) => void): (() => void) =>
        backing.watch(args, handler)
    callable.raw = async (args: Args, init?: RequestInit): Promise<Response> => {
        const value = await Promise.resolve(rawSource(args))
        if (value instanceof Response) return value
        return new Response(JSON.stringify(value), {
            status: 200,
            headers: { 'content-type': 'application/json' },
            ...(init ?? {}),
        })
    }
    callable.isError = (e: unknown, name: string): boolean => isTypedError(e, name)
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
    // slot); only the StreamRead/StreamMutation type surfaces them. `peek` is already stream-aware.
    const streamable = callable as Rpc<Args, T> & {
        chunks(args: Args): unknown[] | undefined
        done(args: Args): boolean
        resumeStream(
            args: Args,
            from: number,
        ): { cursor: AsyncIterable<unknown> | undefined; fresh: boolean }
    }
    streamable.chunks = (args: Args): unknown[] | undefined => backing.chunks(args)
    streamable.done = (args: Args): boolean => backing.done(args)
    streamable.resumeStream = (args: Args, from: number) => backing.resumeStream(args, from)
    attachMeta(callable, { method, handler: rawSource, options, read, timeout })
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

export function makeRead<Args, T>(
    method: string,
    fn: (args: Args) => Promise<T> | T,
    opts?: RpcOptions,
): Rpc<Args, T> {
    const options = opts ?? {}

    // Only forward set fields — exactOptionalPropertyTypes forbids an explicit undefined.
    const memoOptions: MemoOptions = {}
    // `memo: false` on a read = don't retain → ttl:0 (coalesce-only, always revalidate), keeping the
    // reactive memo surface (a full memo bypass is a mutation-only opt-out, since reads need the surface).
    if (options.memo === false) {
        memoOptions.ttl = 0
    } else {
        const memoConfig = options.memo
        if (memoConfig?.ttl !== undefined) memoOptions.ttl = memoConfig.ttl
        // `crossRequest` opts this read into the process-global cross-request cache (rpc-core §2).
        // Server-only and fail-closed inside the memo: the handler runs scope-exited and reads require a
        // live scope. Named for what it does — `state.shared` is a different concept (ADR 0027 D5).
        if (memoConfig?.crossRequest === true) memoOptions.crossRequest = true
        // Tags register a crossRequest read for the global `invalidate/refresh({ tags })` selectors
        // (rpc-core §8). Honored only on a crossRequest memo (server-only registry); inert otherwise.
        if (memoConfig?.tags !== undefined) memoOptions.tags = memoConfig.tags
    }
    // Late-bound broadcast target: the memo gets a stable, transport-free sink now; `createApp` sets
    // the actual publish target via `bindBroadcast` once the route name is known. Unbound → no-op.
    let broadcast: MemoNotify | undefined
    // An rpc handler is a LOADER, not a derivation — an async body is its expected shape, so suppress
    // the auto-tracking diagnostic (ADR 0027 D8) that would otherwise fire on every zero-arg rpc.
    memoOptions.loader = true
    // The deadline is the MEMO's (ADR 0028 D2): the memo owns the run, so one coalesced slot has one
    // deadline and every joined caller observes the identical outcome.
    const timeout = resolveRpcTimeout(options, method)
    memoOptions.timeout = timeout
    memoOptions.notify = (verb, args, value): void => {
        if (broadcast !== undefined) broadcast(verb, args, value)
    }
    const backing = memo<Args, T>(fn, memoOptions)

    // A caller's `signal` detaches THEIR wait and leaves the run alone (ADR 0028 D3) — the run belongs
    // to the memo slot, which other callers are coalesced onto.
    const rpc = ((args: Args, options?: RpcCallOptions): Promise<T> =>
        withAbort(
            settleRead(() => backing(args)),
            options?.signal,
        )) as unknown as Rpc<Args, T>
    attachSurface(rpc, backing, fn, method, options, true, timeout, (sink) => {
        broadcast = sink
    })
    return rpc
}

export function makeMutation<Args, R>(
    method: string,
    fn: (args: Args) => Promise<R> | R,
    opts?: RpcOptions,
): MutationSurface<Args, R> {
    const options = opts ?? {}
    type T = Payload<R>

    // `fn` returns the (possibly transport-wrapped) `R`; the memo sees through it to the payload `T`.
    const handler = fn as unknown as (args: Args) => Promise<T> | T

    // A mutation is a memo + transport exactly like a read — the memo backs BOTH the coalescing call
    // and the whole probe surface. It differs only in the DEFAULT policy: ttl:0 (coalesce identical
    // concurrent in-flight calls, retain nothing) where a read retains. `memo: { ttl }` opts a mutation
    // into retention and the surface reflects it. `memo: false` still builds a memo so the surface
    // exists (probes read an empty slot), but the bare CALL bypasses it for a direct at-least-once run.
    const memoed = options.memo !== false
    const memoConfig = options.memo === false ? undefined : options.memo
    const memoOptions: MemoOptions = { ttl: memoConfig?.ttl ?? 0 }
    if (memoConfig?.crossRequest === true) memoOptions.crossRequest = true
    if (memoConfig?.tags !== undefined) memoOptions.tags = memoConfig.tags
    let broadcast: MemoNotify | undefined
    // An rpc handler is a LOADER, not a derivation — an async body is its expected shape, so suppress
    // the auto-tracking diagnostic (ADR 0027 D8) that would otherwise fire on every zero-arg rpc.
    memoOptions.loader = true
    const timeout = resolveRpcTimeout(options, method)
    memoOptions.timeout = timeout
    memoOptions.notify = (verb, args, value): void => {
        if (broadcast !== undefined) broadcast(verb, args, value)
    }
    const backing = memo<Args, T>(handler, memoOptions)

    const mutation = ((args: Args | FormData, options?: RpcCallOptions): Promise<T> => {
        // A FormData/multipart body can't be safely keyed (files have no cheap canonical value; a raw
        // FormData throws in canonicalKey), and `memo: false` opts the call out entirely → run the
        // handler directly (at-least-once). Otherwise route through the memo (coalesce/retain).
        if (!memoed || (typeof FormData !== 'undefined' && args instanceof FormData)) {
            // The memo-bypass path still gets its deadline (ADR 0028): `memo: false` opts out of
            // coalescing and retention, not out of being bounded — and with no slot there is nothing else
            // left to bound it.
            return withAbort(
                Promise.resolve(withDeadline(handler(args as Args), timeout)),
                options?.signal,
            )
        }
        return withAbort(
            settleRead(() => backing(args as Args)),
            options?.signal,
        )
    }) as unknown as Rpc<Args, T>
    attachSurface(mutation, backing, handler, method, options, false, timeout, (sink) => {
        broadcast = sink
    })
    return mutation as unknown as MutationSurface<Args, R>
}
