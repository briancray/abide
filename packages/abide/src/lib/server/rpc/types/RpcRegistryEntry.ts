import type { ErrorJsonSchemas } from '../../../shared/types/ErrorJsonSchemas.ts'
import type { RemoteFunction } from '../../../shared/types/RemoteFunction.ts'
import type { StandardSchemaV1 } from '../../../shared/types/StandardSchemaV1.ts'

/*
Per-rpc registry record on the server side. MCP and CLI enumerate this
to discover what shapes an rpc expects/returns. The schemas stay off the
public RemoteFunction shape so the browser-side proxy doesn't need to carry
server-only state; the resolved `clients` and `crossOrigin` ride on
`entry.remote` (ADR-0020 sweep finding #4 — no duplicate fields), so readers
reach them via `entry.remote.clients` / `entry.remote.crossOrigin`.

`inputSchema` validates the argument bag and feeds the MCP tool
`inputSchema` / OpenAPI parameters; `outputSchema` describes the success
body and feeds the OpenAPI 200 response + MCP tool `outputSchema`. Each
projects to JSON Schema via its own `toJSONSchema()` (jsonSchemaForSchema) —
schemas whose library lacks one are wrapped with withJsonSchema.

`filesSchema` validates the File parts of a multipart body, kept separate
from `inputSchema` because a File has no honest JSON-Schema conversion — it
stays out of the MCP/CLI projection that `inputSchema` feeds, and the OpenAPI
multipart body advertises the file parts generically as binary.
*/
export type RpcRegistryEntry = {
    remote: RemoteFunction<unknown, unknown>
    inputSchema: StandardSchemaV1 | undefined
    /* The handler's input args projected to JSON Schema at build time (ADR-0030 input side) — the
       input surface's fallback when no `inputSchema` VALIDATOR is declared, mirroring how
       `outputJsonSchema` backs the output surface. Already JSON Schema (not a validator), so surfaces
       use it verbatim; `inputSchema`, when present, overrides it. It also makes the endpoint
       advertisable (MCP/CLI) — the same role a declared `inputSchema` plays — but purely as a SHAPE
       description: it is never run as runtime validation, so it can't produce a 422. */
    inputJsonSchema: Record<string, unknown> | undefined
    outputSchema: StandardSchemaV1 | undefined
    /* The handler's return type projected to JSON Schema at build time (ADR-0030 D2) — the output
       surface's fallback when no `outputSchema` VALIDATOR is declared. Already JSON Schema (not a
       validator), so surfaces use it verbatim; `outputSchema`, when present, overrides it. */
    outputJsonSchema: Record<string, unknown> | undefined
    /* The handler's typed-error branches projected to a status-keyed JSON-Schema map at build time
       (ADR-0030) — each `error.typed(...)` return branch's status + `data` payload. Feeds the OpenAPI
       `responses[status]` entries alongside the 200; undefined when the handler declares no typed
       errors or the build couldn't resolve them, so the surface omits the error responses. */
    errorJsonSchemas: ErrorJsonSchemas | undefined
    filesSchema: StandardSchemaV1 | undefined
    /* The rpc's declared opts, recorded so introspection (inspector) can report
       the deadline/body-cap a handler runs under. Undefined = the framework default
       (no deadline, Bun's server-wide body ceiling). */
    timeout: number | undefined
    maxBodySize: number | undefined
}
