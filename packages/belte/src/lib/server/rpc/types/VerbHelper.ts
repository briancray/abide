import type { ClientFlags } from '../../../shared/types/ClientFlags.ts'
import type { RemoteFunction } from '../../../shared/types/RemoteFunction.ts'
import type { StandardSchemaV1 } from '../../../shared/types/StandardSchemaV1.ts'
import type { RemoteHandler } from './RemoteHandler.ts'

/*
Shared signature for every verb helper (GET / POST / …). Three overloads:

  - `Verb(fn, { inputSchema, outputSchema?, clients? })` — `Args` infers
    from `InferInput<InputSchema>`, the handler receives
    `InferOutput<InputSchema>`. Generic order is `<Return, InputSchema>` so
    users can override `Return` while letting `InputSchema` infer from
    `opts.inputSchema`. `outputSchema` is an optional Standard Schema for
    the success body — it feeds the OpenAPI 200 response and the MCP tool
    `outputSchema`. JSON Schema is projected from each schema's own
    `toJSONSchema()` (wrap with withJsonSchema if the library lacks one).
    `clients` controls which surfaces (browser / mcp / cli) expose this verb.
  - `Verb(fn, { clients })` — schemaless but with explicit client
    targeting (e.g. server-internal RPC with `clients: { browser: false }`).
  - `Verb(fn)` — bare handler. `Args` and `Return` come from the handler
    type; `Return` is usually inferred via the `TypedResponse<T>` brand on
    `json`/`error`/`redirect`/`jsonl`/`sse`.
*/
export type VerbHelper = {
    /*
    `Verb(fn, { inputSchema, filesSchema, … })` — multipart upload. The
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
    >(
        fn: RemoteHandler<
            StandardSchemaV1.InferOutput<InputSchema> & StandardSchemaV1.InferOutput<FilesSchema>,
            Return
        >,
        opts: {
            inputSchema: InputSchema
            filesSchema: FilesSchema
            outputSchema?: StandardSchemaV1
            clients?: Partial<ClientFlags>
        },
    ): RemoteFunction<StandardSchemaV1.InferInput<InputSchema>, Return>
    <Return = unknown, InputSchema extends StandardSchemaV1 = StandardSchemaV1>(
        fn: RemoteHandler<StandardSchemaV1.InferOutput<InputSchema>, Return>,
        opts: {
            inputSchema: InputSchema
            outputSchema?: StandardSchemaV1
            clients?: Partial<ClientFlags>
        },
    ): RemoteFunction<StandardSchemaV1.InferInput<InputSchema>, Return>
    <Args = undefined, Return = unknown>(
        fn: RemoteHandler<Args, Return>,
        opts: {
            outputSchema?: StandardSchemaV1
            clients: Partial<ClientFlags>
        },
    ): RemoteFunction<Args, Return>
    <Args = undefined, Return = unknown>(
        fn: RemoteHandler<Args, Return>,
    ): RemoteFunction<Args, Return>
}
