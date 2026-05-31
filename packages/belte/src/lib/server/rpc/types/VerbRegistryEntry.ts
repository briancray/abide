import type { ClientFlags } from '../../../shared/types/ClientFlags.ts'
import type { RemoteFunction } from './RemoteFunction.ts'
import type { StandardSchemaV1 } from './StandardSchemaV1.ts'

/*
Per-verb registry record on the server side. MCP and CLI enumerate this
to discover which RPCs are advertised (clients flags) and what shapes
they expect/return. The schemas and resolved clients stay off the public
RemoteFunction shape so the browser-side proxy doesn't need to carry
server-only state.

`inputSchema` validates the argument bag and feeds the MCP tool
`inputSchema` / OpenAPI parameters; `outputSchema` describes the success
body and feeds the OpenAPI 200 response + MCP tool `outputSchema`. The
`*JsonSchema` siblings are optional user-supplied JSON Schema overrides
(used verbatim when present, otherwise derived from the Standard Schema).
*/
export type VerbRegistryEntry = {
    remote: RemoteFunction<unknown, unknown>
    inputSchema: StandardSchemaV1 | undefined
    inputJsonSchema: Record<string, unknown> | undefined
    outputSchema: StandardSchemaV1 | undefined
    outputJsonSchema: Record<string, unknown> | undefined
    clients: ClientFlags
}
