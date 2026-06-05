import type { ClientFlags } from '../../../shared/types/ClientFlags.ts'
import type { RemoteFunction } from '../../../shared/types/RemoteFunction.ts'
import type { StandardSchemaV1 } from '../../../shared/types/StandardSchemaV1.ts'

/*
Per-verb registry record on the server side. MCP and CLI enumerate this
to discover which RPCs are advertised (clients flags) and what shapes
they expect/return. The schemas and resolved clients stay off the public
RemoteFunction shape so the browser-side proxy doesn't need to carry
server-only state.

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
export type VerbRegistryEntry = {
    remote: RemoteFunction<unknown, unknown>
    inputSchema: StandardSchemaV1 | undefined
    outputSchema: StandardSchemaV1 | undefined
    filesSchema: StandardSchemaV1 | undefined
    clients: ClientFlags
}
