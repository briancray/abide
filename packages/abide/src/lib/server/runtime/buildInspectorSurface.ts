import { jsonSchemaForSchema } from '../../shared/jsonSchemaForSchema.ts'
import { promptRegistry } from '../prompts/promptRegistry.ts'
import { rpcRegistry } from '../rpc/rpcRegistry.ts'
import { socketOperations } from '../sockets/socketOperations.ts'
import { socketRegistry } from '../sockets/socketRegistry.ts'
import type { InspectorSurface } from './types/InspectorSurface.ts'

/*
Projects the live rpc + socket registries into the inspector's catalog. Read
at call time (not cached) so rpcs constructed after boot — lazily on first
hit, or eagerly once ensureRegistriesLoaded walked the manifest — show up.
Schemas go through jsonSchemaForSchema, the same projection MCP and OpenAPI
use, so the three can't disagree on a rpc's shape; a missing schema stays
undefined to mark a rpc that carries no machine-advertisable contract.
*/
export function buildInspectorSurface(): InspectorSurface {
    const rpcs = Array.from(rpcRegistry.values()).map((entry) => ({
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
    return { rpcs, sockets, prompts }
}
