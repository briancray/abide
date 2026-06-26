import type { ClientFlags } from '../../../shared/types/ClientFlags.ts'
import type { ErrorSpec } from '../../../shared/types/ErrorSpec.ts'
import type { RemoteFunction } from '../../../shared/types/RemoteFunction.ts'
import type { StandardSchemaV1 } from '../../../shared/types/StandardSchemaV1.ts'
import type { RemoteHandler } from './RemoteHandler.ts'

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
Shared signature for every rpc helper (GET / POST / …). Three overloads:

  - `Rpc(fn, { inputSchema, outputSchema?, clients? })` — `Args` infers
    from `InferInput<InputSchema>`, the handler receives
    `InferOutput<InputSchema>`. Generic order is `<Return, InputSchema>` so
    users can override `Return` while letting `InputSchema` infer from
    `opts.inputSchema`. `outputSchema` is an optional Standard Schema for
    the success body — it feeds the OpenAPI 200 response and the MCP tool
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
  - `Rpc(fn)` — bare handler. `Args` and `Return` come from the handler
    type; `Return` is usually inferred via the `TypedResponse<T>` brand on
    `json`/`error`/`redirect`/`jsonl`/`sse`.
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
        Return = unknown,
        InputSchema extends StandardSchemaV1 = StandardSchemaV1,
        FilesSchema extends StandardSchemaV1 = StandardSchemaV1,
        Errors extends ErrorSpec = Record<string, never>,
    >(
        fn: RemoteHandler<
            StandardSchemaV1.InferOutput<InputSchema> & StandardSchemaV1.InferOutput<FilesSchema>,
            Return,
            Errors
        >,
        opts: Opts & {
            inputSchema: InputSchema
            filesSchema: FilesSchema
            errors?: Errors
        },
    ): RemoteFunction<StandardSchemaV1.InferInput<InputSchema>, Return, Errors>
    <
        Return = unknown,
        InputSchema extends StandardSchemaV1 = StandardSchemaV1,
        Errors extends ErrorSpec = Record<string, never>,
    >(
        fn: RemoteHandler<StandardSchemaV1.InferOutput<InputSchema>, Return, Errors>,
        opts: Opts & { inputSchema: InputSchema; errors?: Errors },
    ): RemoteFunction<StandardSchemaV1.InferInput<InputSchema>, Return, Errors>
    <Args = undefined, Return = unknown, Errors extends ErrorSpec = Record<never, never>>(
        fn: RemoteHandler<Args, Return, Errors>,
        opts: Opts & { errors?: Errors },
    ): RemoteFunction<Args, Return, Errors>
    <Args = undefined, Return = unknown>(
        fn: RemoteHandler<Args, Return>,
    ): RemoteFunction<Args, Return>
}

/* The read helpers (GET/HEAD): no `outbox` — a read has nothing to durably deliver. */
export type RpcHelper = RpcHelperOf<RpcBaseOpts>

/*
The mutating helpers (POST/PUT/PATCH/DELETE). A durable (`outbox`) call is a normal
RemoteFunction — it throws exactly like a non-durable one and only parks the request as a
side-effect on an unreachable server — so there is no separate return shape; `outbox` rides
MutatingRpcOpts and `rpc.outbox` exposes the queue. The distinct opts base is what makes
`outbox` legal here and a compile error on the read helpers.
*/
export type MutatingRpcHelper = RpcHelperOf<MutatingRpcOpts>
