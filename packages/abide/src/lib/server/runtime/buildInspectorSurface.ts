import { jsonSchemaForSchema } from '../../shared/jsonSchemaForSchema.ts'
import { promptRegistry } from '../prompts/promptRegistry.ts'
import { verbRegistry } from '../rpc/verbRegistry.ts'
import { socketOperations } from '../sockets/socketOperations.ts'
import { socketRegistry } from '../sockets/socketRegistry.ts'
import type { InspectorSurface } from './types/InspectorSurface.ts'

/*
Projects the live verb + socket registries into the inspector's catalog. Read
at call time (not cached) so verbs constructed after boot — lazily on first
hit, or eagerly once ensureRegistriesLoaded walked the manifest — show up.
Schemas go through jsonSchemaForSchema, the same projection MCP and OpenAPI
use, so the three can't disagree on a verb's shape; a missing schema stays
undefined to mark a verb that carries no machine-advertisable contract.
*/
export function buildInspectorSurface(): InspectorSurface {
    const verbs = Array.from(verbRegistry.values()).map((entry) => ({
        url: entry.remote.url,
        method: entry.remote.method,
        clients: { ...entry.remote.clients },
        inputSchema: entry.inputSchema ? jsonSchemaForSchema(entry.inputSchema) : undefined,
        outputSchema: entry.outputSchema ? jsonSchemaForSchema(entry.outputSchema) : undefined,
        files: entry.filesSchema !== undefined,
        timeout: entry.timeout,
        maxBodySize: entry.maxBodySize,
        crossOrigin: entry.crossOrigin,
    }))
    const sockets = Array.from(socketRegistry.values()).map((entry) => ({
        name: entry.socket.name,
        operations: socketOperations(entry).map((operation) => ({
            kind: operation.kind,
            name: operation.name,
            method: operation.method,
            restUrl: operation.restUrl,
        })),
    }))
    /* jsonSchema is already JSON Schema (built from the frontmatter `arguments`
       list by the resolver plugin), so it's passed through, not re-projected. */
    const prompts = Array.from(promptRegistry.values()).map((entry) => ({
        name: entry.prompt.name,
        description: entry.prompt.description,
        inputSchema: entry.jsonSchema,
    }))
    return { verbs, sockets, prompts }
}
