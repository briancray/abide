import type { ClientFlags } from '../../../shared/types/ClientFlags.ts'
import type { StandardSchemaV1 } from '../../../shared/types/StandardSchemaV1.ts'

/*
Server-side options passed when declaring a socket via `socket<T>(opts)`.
History buffer (replayed on first iteration), per-frame TTL (history
entries older than `ttl` ms are evicted before replay), and the client-
publish gate (off by default — server-only topics ignore pub frames
coming over the wire). Optional Standard Schema validates payloads on
publish and gives MCP / CLI a typed payload to describe (projected via the
schema's own `toJSONSchema()` — wrap with withJsonSchema if its library lacks
one). `clients` controls which non-browser surfaces (mcp / cli) expose this
socket; browser is the historical default. All server-only state the bundler
strips out of the client stub.
*/
export type SocketOptions<Schema extends StandardSchemaV1 = StandardSchemaV1> = {
    history?: number
    ttl?: number
    clientPublish?: boolean
    schema?: Schema
    clients?: Partial<ClientFlags>
}
