// The abide REGISTRY (machine-surfaces.md MS1) — the single build-time description of an app's
// machine-facing surface, from which OpenAPI, MCP, and the CLI all project. It walks the
// createApp config once and normalises every RPC and socket into a flat, monomorphic entry list:
// name, method, read/mutate, resolved JSON Schemas (when available), `clients` exposure flags,
// and doc string.
//
// JSON Schema resolution (MS1.3): an RPC's input/output schema may be given as a raw JSON Schema
// OR a Standard Schema (Zod/Valibot/etc.). A JSON Schema is captured as-is; a Standard Schema is
// left undefined here — its JSON Schema is not available without type-derivation, which a build
// step attaches later. Surfaces treat a missing schema permissively.

import type { JSONSchema } from '../../shared/internal/jsonSchema.ts'
import { jsonSchemaOf } from '../../shared/internal/shapeToSchema.ts'
import type { AppConfig, Route } from './router.ts'

// Per-surface exposure flags (§13.3). All default-on: an absent flag means "exposed". Only an
// explicit `false` withholds a surface (e.g. `clients.browser === false` → omitted from OpenAPI).
export interface Clients {
    browser?: boolean
    mcp?: boolean
    cli?: boolean
}

export interface RpcEntry {
    name: string
    method: string
    read: boolean
    // Opt-in server cross-request cache (rpc-core §2). Surfaced so the client bundle can flag the read
    // proxy as `shared` — a shared read auto-subscribes to its broadcast channel (shared-cache-plan §2.5).
    shared: boolean
    inputSchema?: JSONSchema
    outputSchema?: JSONSchema
    clients: Clients
    doc?: string
}

export interface SocketEntry {
    name: string
    messageSchema?: JSONSchema
    clientPublish: boolean
    // Retention knobs the client proxy needs (client-sockets.md CS7): `tail` sizes the `chunks()` cap,
    // `ttl` (ms; Infinity = sticky) windows `peek()`.
    tail: number
    ttl: number
    clients: Clients
}

export interface Registry {
    rpcs: RpcEntry[]
    sockets: SocketEntry[]
}

// Normalise the (untyped) `options.clients` into the flat Clients shape. A non-object is treated
// as "all surfaces on".
function resolveClients(raw: unknown): Clients {
    if (typeof raw !== 'object' || raw === null) return {}
    const source = raw as Record<string, unknown>
    const clients: Clients = {}
    if (typeof source.browser === 'boolean') clients.browser = source.browser
    if (typeof source.mcp === 'boolean') clients.mcp = source.mcp
    if (typeof source.cli === 'boolean') clients.cli = source.cli
    return clients
}

function rpcEntry(name: string, route: Route): RpcEntry {
    const meta = route.__rpc
    const options = meta.options
    const schemas = options.schemas

    const entry: RpcEntry = {
        name,
        method: meta.method,
        read: meta.read,
        shared: options.cache !== false && options.cache?.shared === true,
        clients: resolveClients(options.clients),
    }

    const inputSchema = jsonSchemaOf(schemas?.input)
    if (inputSchema !== undefined) entry.inputSchema = inputSchema

    const outputSchema = jsonSchemaOf(schemas?.output)
    if (outputSchema !== undefined) entry.outputSchema = outputSchema

    if (typeof options.doc === 'string' && options.doc.length > 0) entry.doc = options.doc

    return entry
}

export function buildRegistry(config: AppConfig): Registry {
    const rpcs: RpcEntry[] = []
    const routes = config.routes ?? {}
    for (const [name, route] of Object.entries(routes)) {
        rpcs.push(rpcEntry(name, route))
    }

    const sockets: SocketEntry[] = []
    const socketMap = config.sockets ?? {}
    for (const [name, socket] of Object.entries(socketMap)) {
        const options = socket.__socket.options
        const entry: SocketEntry = {
            name,
            clientPublish: options.clientPublish === true,
            tail: typeof options.tail === 'number' ? options.tail : 0,
            ttl: typeof options.ttl === 'number' ? options.ttl : Infinity,
            clients: resolveClients(options.clients),
        }
        const messageSchema = jsonSchemaOf(options.schema)
        if (messageSchema !== undefined) entry.messageSchema = messageSchema
        sockets.push(entry)
    }

    return { rpcs, sockets }
}
