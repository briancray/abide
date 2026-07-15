import type { CachePolicy } from '../../../shared/types/CachePolicy.ts'
import type { ClientFlags } from '../../../shared/types/ClientFlags.ts'
import type { ErrorSpec } from '../../../shared/types/ErrorSpec.ts'
import type { RemoteFunction } from '../../../shared/types/RemoteFunction.ts'
import type { StandardSchemaV1 } from '../../../shared/types/StandardSchemaV1.ts'
import type { StreamPolicy } from '../../../shared/types/StreamPolicy.ts'
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
body to `any`.
*/
type RpcOf<F extends RpcFn> = RemoteFunction<
    RpcArgs<F>,
    SuccessBody<Awaited<ReturnType<F>>>,
    InferredErrors<Awaited<ReturnType<F>>>
>

/*
The schema namespace (ADR-0020): `schemas: { input?, output?, files? }` replaces the
flat `inputSchema`/`outputSchema`/`filesSchema`. `input` drives the handler's arg type,
`output` is the success-body schema (OpenAPI 200 / MCP outputSchema — never drives arg
inference), `files` validates multipart File parts. The schema-bearing helper overloads
tighten specific members to required.
*/
type RpcSchemas = {
    input?: StandardSchemaV1
    output?: StandardSchemaV1
    files?: StandardSchemaV1
}

/*
Options every rpc overload accepts: the `schemas` namespace, the `clients` surface
flags (browser/mcp/cli), the same-origin CSRF exemption (`crossOrigin`), the pre-parse
body-byte ceiling (`maxBodySize`), the per-surface handler `timeout` (ms), and the
endpoint `cache` policy (ADR-0020). `cache` is shared by both kinds: a mutating rpc
whose method is a transport choice (a POST that carries a large `code` payload in its
body yet is a pure function of its args) still coalesces/memoises like a read — the
runtime already routes `fn.cache` through `readThrough` regardless of method. What stays
read-only is `stream` (`RpcReadOpts`) — a write has no replayable value to stream.
Generic over `Args` so `cache.tags`'s `(args) => string[]` form is typed against the
rpc's own argument shape. The single canonical source both `defineRpc` and
`RpcRegistryEntry` project from.
*/
type RpcSharedOpts<Args> = {
    schemas?: RpcSchemas
    clients?: Partial<ClientFlags>
    crossOrigin?: boolean
    maxBodySize?: number
    timeout?: number
    cache?: CachePolicy<Args>
}

/*
Read-helper (GET/HEAD) options: the shared base (including `cache`) plus the endpoint
`stream` policy (`n`, replay depth) — the one option kind-scoped to replayable reads,
since a write has no replayable stream. Generic over `Args`, threaded into the shared
base so `cache.tags`'s `(args) => string[]` form is typed against the rpc's own args.
*/
type RpcReadOpts<Args> = RpcSharedOpts<Args> & {
    stream?: StreamPolicy
}

/*
The read helpers (GET/HEAD). The handler's return type is inferred whole
(`Awaited<ReturnType<F>>`), then split: `SuccessBody` becomes the caller's `Return`,
`InferredErrors` becomes the rpc's `Errors` (driving `isError`). Typed errors are raised
by returning an `error.typed(name, status, schema?)` constructor — there is no `errors:`
opt. Four overloads by argument source (most-specific first):

  - `GET(fn, { schemas: { input, files, output? }, cache?, … })` — multipart upload.
    The handler receives the text fields (`InferOutput<input>`) intersected with the
    validated File parts (`InferOutput<files>`); the call site sends a FormData. `files`
    stays off the JSON-Schema projection (a File has no honest conversion) — only `input`
    feeds MCP/CLI/OpenAPI. `Args` (the RemoteFunction's call type) is `InferInput<input>`.
  - `GET(fn, { schemas: { input, output? }, cache?, … })` — `Args` = `InferInput<input>`,
    the handler receives `InferOutput<input>`. `output` feeds the OpenAPI 200 / MCP tool
    outputSchema and never drives arg inference.
  - `GET(fn, opts)` — schemaless-with-opts (includes `schemas: { output }`-only): args
    read off the handler `F`. `cache`/`clients`/`timeout`/… live here.
  - `GET(fn)` — bare handler; everything reads off `F`: `Args` from its parameter, `Return`
    from the `TypedResponse<T>` brand, `Errors` from any `error.typed(...)` branches. You
    never pass `<Args, Return>` generics; a stray one is a loud constraint error.
*/
export type RpcHelper = {
    <
        R extends Response,
        InputSchema extends StandardSchemaV1 = StandardSchemaV1,
        FilesSchema extends StandardSchemaV1 = StandardSchemaV1,
    >(
        fn: (
            args: StandardSchemaV1.InferOutput<InputSchema> &
                StandardSchemaV1.InferOutput<FilesSchema>,
        ) => R | Promise<R>,
        opts: RpcReadOpts<StandardSchemaV1.InferInput<InputSchema>> & {
            schemas: { input: InputSchema; files: FilesSchema; output?: StandardSchemaV1 }
        },
    ): RemoteFunction<StandardSchemaV1.InferInput<InputSchema>, SuccessBody<R>, InferredErrors<R>>
    <R extends Response, InputSchema extends StandardSchemaV1 = StandardSchemaV1>(
        fn: (args: StandardSchemaV1.InferOutput<InputSchema>) => R | Promise<R>,
        opts: RpcReadOpts<StandardSchemaV1.InferInput<InputSchema>> & {
            schemas: { input: InputSchema; output?: StandardSchemaV1 }
        },
    ): RemoteFunction<StandardSchemaV1.InferInput<InputSchema>, SuccessBody<R>, InferredErrors<R>>
    <F extends RpcFn>(fn: F, opts: RpcReadOpts<RpcArgs<F>>): RpcOf<F>
    <F extends RpcFn>(fn: F): RpcOf<F>
}

/*
The mutating helpers (POST/PUT/PATCH/DELETE). The base opts is the shared `RpcSharedOpts`,
which carries `cache` — a mutating rpc still accepts a cache policy (a POST that is a pure
function of its args, using the body only to carry a large payload, coalesces/memoises like
a read; the runtime honours `fn.cache` regardless of method). Note the method default for a
write stays coalesce-only: a no-ttl write is dropped on settle (the mutation idiom), so
retention across the in-flight window needs an explicit `cache.ttl` (or `shared`). Only
`stream` stays read-only (`RpcReadOpts`) — a write has no replayable stream — so `POST(fn,
{ stream })` remains a compile error while `POST(fn, { cache })` is legal. Overloads mirror
the read helpers by argument source (multipart-upload, schema'd, schemaless-with-opts, bare).
*/
export type MutatingRpcHelper = {
    <
        R extends Response,
        InputSchema extends StandardSchemaV1 = StandardSchemaV1,
        FilesSchema extends StandardSchemaV1 = StandardSchemaV1,
    >(
        fn: (
            args: StandardSchemaV1.InferOutput<InputSchema> &
                StandardSchemaV1.InferOutput<FilesSchema>,
        ) => R | Promise<R>,
        opts: RpcSharedOpts<StandardSchemaV1.InferInput<InputSchema>> & {
            schemas: { input: InputSchema; files: FilesSchema; output?: StandardSchemaV1 }
        },
    ): RemoteFunction<StandardSchemaV1.InferInput<InputSchema>, SuccessBody<R>, InferredErrors<R>>
    <R extends Response, InputSchema extends StandardSchemaV1 = StandardSchemaV1>(
        fn: (args: StandardSchemaV1.InferOutput<InputSchema>) => R | Promise<R>,
        opts: RpcSharedOpts<StandardSchemaV1.InferInput<InputSchema>> & {
            schemas: { input: InputSchema; output?: StandardSchemaV1 }
        },
    ): RemoteFunction<StandardSchemaV1.InferInput<InputSchema>, SuccessBody<R>, InferredErrors<R>>
    <F extends RpcFn>(fn: F, opts: RpcSharedOpts<RpcArgs<F>>): RpcOf<F>
    <F extends RpcFn>(fn: F): RpcOf<F>
}
