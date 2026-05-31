import type { ClientFlags } from '../../../shared/types/ClientFlags.ts'
import type { RemoteFunction } from './RemoteFunction.ts'
import type { RemoteHandler } from './RemoteHandler.ts'
import type { StandardSchemaV1 } from './StandardSchemaV1.ts'

/*
Shared signature for every verb helper (GET / POST / …). Three overloads:

  - `Verb(fn, { inputSchema, outputSchema?, clients? })` — `Args` infers
    from `InferInput<InputSchema>`, the handler receives
    `InferOutput<InputSchema>`. Generic order is `<Return, InputSchema>` so
    users can override `Return` while letting `InputSchema` infer from
    `opts.inputSchema`. `outputSchema` is an optional Standard Schema for
    the success body — it feeds the OpenAPI 200 response and the MCP tool
    `outputSchema`. `inputJsonSchema` / `outputJsonSchema` are optional
    precomputed JSON Schema overrides. `clients` controls which surfaces
    (browser / mcp / cli) expose this verb.
  - `Verb(fn, { clients })` — schemaless but with explicit client
    targeting (e.g. server-internal RPC with `clients: { browser: false }`).
  - `Verb(fn)` — bare handler. `Args` and `Return` come from the handler
    type; `Return` is usually inferred via the `TypedResponse<T>` brand on
    `json`/`error`/`redirect`/`jsonl`/`sse`.
*/
export type VerbHelper = {
    <Return = unknown, InputSchema extends StandardSchemaV1 = StandardSchemaV1>(
        fn: RemoteHandler<StandardSchemaV1.InferOutput<InputSchema>, Return>,
        opts: {
            inputSchema: InputSchema
            inputJsonSchema?: Record<string, unknown>
            outputSchema?: StandardSchemaV1
            outputJsonSchema?: Record<string, unknown>
            clients?: Partial<ClientFlags>
        },
    ): RemoteFunction<StandardSchemaV1.InferInput<InputSchema>, Return>
    <Args = undefined, Return = unknown>(
        fn: RemoteHandler<Args, Return>,
        opts: {
            inputJsonSchema?: Record<string, unknown>
            outputSchema?: StandardSchemaV1
            outputJsonSchema?: Record<string, unknown>
            clients: Partial<ClientFlags>
        },
    ): RemoteFunction<Args, Return>
    <Args = undefined, Return = unknown>(
        fn: RemoteHandler<Args, Return>,
    ): RemoteFunction<Args, Return>
}
