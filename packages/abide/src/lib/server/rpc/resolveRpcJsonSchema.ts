import { jsonSchemaForSchema } from '../../shared/jsonSchemaForSchema.ts'
import type { RpcRegistryEntry } from './types/RpcRegistryEntry.ts'

/*
The ONE resolution every surface (MCP tools, OpenAPI, the inspector catalog, and the
standalone CLI manifest) uses for an rpc's advertised INPUT shape: a declared
`inputSchema` VALIDATOR overrides the build-projected `inputJsonSchema` (ADR-0030 input
side); with neither, `undefined`. Callers that need a non-empty schema apply the opaque
`?? jsonSchemaForSchema(undefined)` fallback themselves (MCP/OpenAPI/CLI want it; the
inspector leaves it undefined). One origin so the surfaces can't drift — the CLI manifest
emitter previously read only `inputSchema` and silently dropped every plainly-typed
handler's projected shape (no typed flags, no `--help`, array flags overwriting).
*/
export function resolveInputJsonSchema(
    entry: RpcRegistryEntry,
): Record<string, unknown> | undefined {
    return entry.inputSchema ? jsonSchemaForSchema(entry.inputSchema) : entry.inputJsonSchema
}

/*
The output analog: an `outputSchema` VALIDATOR overrides the projected `outputJsonSchema`;
with neither, `undefined` (no output shape advertised — every surface leaves it off).
*/
export function resolveOutputJsonSchema(
    entry: RpcRegistryEntry,
): Record<string, unknown> | undefined {
    return entry.outputSchema ? jsonSchemaForSchema(entry.outputSchema) : entry.outputJsonSchema
}
