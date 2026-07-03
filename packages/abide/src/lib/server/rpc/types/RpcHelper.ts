import type { ClientFlags } from '../../../shared/types/ClientFlags.ts'
import type { ErrorSpec } from '../../../shared/types/ErrorSpec.ts'
import type { RemoteFunction } from '../../../shared/types/RemoteFunction.ts'
import type { StandardSchemaV1 } from '../../../shared/types/StandardSchemaV1.ts'
import type { TypedError } from './TypedError.ts'
import type { TypedResponse } from './TypedResponse.ts'

/*
The success body carried by a handler's return type `R`. Error branches
(`TypedError`, checked first since they're also Responses) drop to `never` and
union away, so `Return` is the body of the success `TypedResponse` members alone
— an untagged `Response` falls back to `unknown`, matching hand-built responses.
*/
type SuccessBody<R> =
    R extends TypedError<string, ErrorSpec[string]>
        ? never
        : R extends TypedResponse<infer Body>
          ? Body
          : unknown

/*
The error spec a handler's return type `R` declares — rebuilt name→entry from the
`TypedError` brands among its branches (distributes over the union; no error
branches → `{}`). This is what gives `rpc.isError` its typed surface with no
`errors:` option: the errors a handler RETURNS are the errors it can raise.
*/
type ErrorBrand<R> =
    R extends TypedError<infer Name, infer Entry> ? { name: Name; entry: Entry } : never
type InferredErrors<R> = { [Brand in ErrorBrand<R> as Brand['name']]: Brand['entry'] }

/*
The handler every bare (schemaless) overload accepts: any args in, a Response (or a
Promise of one) out. Collapsing the old `<Args, R>` pair into this single inferred
function type is deliberate. TypeScript has no partial type-argument inference, so
`GET<Args>(fn)` used to drop `R` to its `Response` default and silently erase the body
to `unknown`. With one generic constrained to `RpcFn`, that same call is instead a loud
`does not satisfy the constraint 'RpcFn'`, and `Args`/`Return`/`Errors` all read
structurally off the handler — args from its parameter, body + errors from its return —
which is where a normal TS function declares them anyway (no mainstream rpc framework
parameterises the call with generics). `any` is load-bearing: `never`/`unknown` in the
parameter position break return inference by contextually widening the handler's body.
*/
type RpcFn = (args: any) => Response | Promise<Response>

/* The handler's declared args: its first parameter, or `undefined` for a nullary handler. */
type RpcArgs<F extends RpcFn> = Parameters<F> extends [infer Args, ...unknown[]] ? Args : undefined

/*
The RemoteFunction a bare overload produces from handler `F`. `SuccessBody`/`InferredErrors`
run over `Awaited<ReturnType<F>>` INLINE (not via an intermediate `extends RpcFn`-constrained
alias) — such an alias resolves `ReturnType` against the constraint bound and degrades the
body to `any`. `Durable` threads the outbox bit through for the durable overloads.
*/
type RpcOf<F extends RpcFn, Durable extends boolean = false> = RemoteFunction<
    RpcArgs<F>,
    SuccessBody<Awaited<ReturnType<F>>>,
    InferredErrors<Awaited<ReturnType<F>>>,
    Durable
>

/*
Options every rpc overload accepts: the OpenAPI 200 `outputSchema`, the
`clients` surface flags, the same-origin CSRF exemption (`crossOrigin`), the
pre-parse body-byte ceiling (`maxBodySize`), and the per-surface handler
`timeout` (ms). The schema-bearing overloads intersect this with their own
`inputSchema`/`filesSchema` members. Mutating helpers widen it with `outbox`
(see MutatingRpcOpts) — a read RPC never accepts it.
*/
type RpcBaseOpts = {
    outputSchema?: StandardSchemaV1
    clients?: Partial<ClientFlags>
    crossOrigin?: boolean
    maxBodySize?: number
    timeout?: number
}

/*
Mutating-helper options: the shared base plus durable delivery. `outbox` lives
here, not on RpcBaseOpts, because a read RPC has nothing to durably deliver —
so `GET(fn, { outbox: true })` is a compile error, not the runtime throw it used
to be. Keeps the type surface honest with the defineRpc guard.
*/
type MutatingRpcOpts = RpcBaseOpts & {
    /* Durable delivery: on an unreachable server the call still throws, and the request is
       parked for replay. Drains on `rpc.outbox.retry()` — no auto-drain. The call shape is
       unchanged — `rpc.outbox` exposes the queue. */
    outbox?: boolean
}

/*
Shared signature for every rpc helper (GET / POST / …). The handler's return
type is inferred whole (`Awaited<ReturnType<F>>`), then split: `SuccessBody`
becomes the caller's `Return`, `InferredErrors` becomes the rpc's `Errors`
(driving `isError`). Typed errors are raised by returning an
`error.typed(name, status, schema?)` constructor — there is no `errors:` opt.
Four overloads by argument source:

  - `Rpc(fn, { inputSchema, outputSchema?, clients? })` — `Args` infers
    from `InferInput<InputSchema>`, the handler receives
    `InferOutput<InputSchema>`. `outputSchema` is an optional Standard Schema
    for the success body — it feeds the OpenAPI 200 response and the MCP tool
    `outputSchema`. JSON Schema is projected from each schema's own
    `toJSONSchema()` (wrap with withJsonSchema if the library lacks one).
    `clients` controls which surfaces (browser / mcp / cli) expose this rpc.
    `crossOrigin: true` exempts a mutating rpc from the router's same-origin
    CSRF gate — by default a browser request whose Origin doesn't match the
    app's own host is refused with 403 on every non-GET/HEAD rpc.
    `maxBodySize` caps the body's actual received bytes (413 past it),
    enforced before parsing; omitted, the only ceiling is Bun.serve's
    server-wide maxRequestBodySize. `timeout` (ms) bounds the handler's
    execution on every surface (SSR / MCP / CLI / network) — a 504 once
    exceeded; on the network path it also aborts request().signal so a
    handler's `fetch(ext, { signal: request().signal })` is cancelled, not
    just abandoned.
  - `Rpc(fn, { clients })` — schemaless but with explicit client
    targeting (e.g. server-internal RPC with `clients: { browser: false }`).
  - `Rpc(fn)` — bare handler, a single `F extends RpcFn` generic. Everything
    is read off the handler: `Args` from its parameter (annotate it —
    `POST((a: { id: string }) => …)` — or leave it nullary for `undefined`),
    `Return` from the `TypedResponse<T>` brand on
    `json`/`error`/`redirect`/`jsonl`/`sse`, `Errors` from any
    `error.typed(...)` branches. You never pass `<Args, Return>` generics; a
    stray one is a loud constraint error, not a silent `unknown` body.
*/
type RpcHelperOf<Opts> = {
    /*
    `Rpc(fn, { inputSchema, filesSchema, … })` — multipart upload. The
    handler receives the text fields (`InferOutput<InputSchema>`) intersected
    with the validated File parts (`InferOutput<FilesSchema>`); both are merged
    into one args bag. The call site sends a FormData (RemoteFunction's call
    accepts it), since a File can't ride a JSON body. filesSchema stays off the
    JSON-Schema projection — a File has no honest conversion (see
    jsonSchemaForSchema) — so only inputSchema feeds MCP/CLI/OpenAPI.
    */
    <
        R extends Response,
        InputSchema extends StandardSchemaV1 = StandardSchemaV1,
        FilesSchema extends StandardSchemaV1 = StandardSchemaV1,
    >(
        fn: (
            args: StandardSchemaV1.InferOutput<InputSchema> &
                StandardSchemaV1.InferOutput<FilesSchema>,
        ) => R | Promise<R>,
        opts: Opts & {
            inputSchema: InputSchema
            filesSchema: FilesSchema
        },
    ): RemoteFunction<StandardSchemaV1.InferInput<InputSchema>, SuccessBody<R>, InferredErrors<R>>
    <R extends Response, InputSchema extends StandardSchemaV1 = StandardSchemaV1>(
        fn: (args: StandardSchemaV1.InferOutput<InputSchema>) => R | Promise<R>,
        opts: Opts & { inputSchema: InputSchema },
    ): RemoteFunction<StandardSchemaV1.InferInput<InputSchema>, SuccessBody<R>, InferredErrors<R>>
    <F extends RpcFn>(fn: F, opts: Opts): RpcOf<F>
    <F extends RpcFn>(fn: F): RpcOf<F>
}

/* The read helpers (GET/HEAD): no `outbox` — a read has nothing to durably deliver. */
export type RpcHelper = RpcHelperOf<RpcBaseOpts>

/*
Durable-call overloads: an `outbox: true` opt returns a RemoteFunction whose `Durable` bit
is set, so `rpc.outbox` is the queue face rather than optionally-undefined. Mirrors the
opts-bearing base overloads (multipart-upload, schema'd, schemaless); the bare `Rpc(fn)`
form has no opts to carry `outbox`, so it stays non-durable. Intersected AHEAD of the base
set in MutatingRpcHelper so an `outbox: true` literal resolves here first.
*/
type DurableMutatingRpcHelper = {
    <
        R extends Response,
        InputSchema extends StandardSchemaV1 = StandardSchemaV1,
        FilesSchema extends StandardSchemaV1 = StandardSchemaV1,
    >(
        fn: (
            args: StandardSchemaV1.InferOutput<InputSchema> &
                StandardSchemaV1.InferOutput<FilesSchema>,
        ) => R | Promise<R>,
        opts: MutatingRpcOpts & {
            inputSchema: InputSchema
            filesSchema: FilesSchema
            outbox: true
        },
    ): RemoteFunction<
        StandardSchemaV1.InferInput<InputSchema>,
        SuccessBody<R>,
        InferredErrors<R>,
        true
    >
    <R extends Response, InputSchema extends StandardSchemaV1 = StandardSchemaV1>(
        fn: (args: StandardSchemaV1.InferOutput<InputSchema>) => R | Promise<R>,
        opts: MutatingRpcOpts & { inputSchema: InputSchema; outbox: true },
    ): RemoteFunction<
        StandardSchemaV1.InferInput<InputSchema>,
        SuccessBody<R>,
        InferredErrors<R>,
        true
    >
    <F extends RpcFn>(fn: F, opts: MutatingRpcOpts & { outbox: true }): RpcOf<F, true>
}

/*
The mutating helpers (POST/PUT/PATCH/DELETE). A durable (`outbox`) call is a normal
RemoteFunction — it throws exactly like a non-durable one and only parks the request as a
side-effect on an unreachable server — so there is no separate return shape; `outbox` rides
MutatingRpcOpts and `rpc.outbox` exposes the queue. The distinct opts base is what makes
`outbox` legal here and a compile error on the read helpers; the durable overloads then set
the return type's `Durable` bit so `rpc.outbox` is present without an optional chain.
*/
export type MutatingRpcHelper = DurableMutatingRpcHelper & RpcHelperOf<MutatingRpcOpts>
