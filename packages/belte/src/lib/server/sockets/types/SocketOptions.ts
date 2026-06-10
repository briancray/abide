import type { ClientFlags } from '../../../shared/types/ClientFlags.ts'
import type { StandardSchemaV1 } from '../../../shared/types/StandardSchemaV1.ts'

/*
Server-side options passed when declaring a socket via `socket<T>(opts)`.
`tail` opts the topic into retention: the socket keeps its last `tail`
frames so readers that weren't there — late joiners, reconnects, the
CLI/MCP/SSE read surfaces — can seed from `.tail(count)`. Omitted, the
socket is a pure live pipe and storage is the consumer's concern (a
`tail(chat, { last: n })` window fills from live frames only). Per-frame
TTL (retained frames older than `ttl` ms are evicted before replay), and
the client-publish gate (off by default — server-only topics ignore pub
frames coming over the wire). Optional Standard Schema validates payloads on
publish and gives MCP / CLI a typed payload to describe (projected via the
schema's own `toJSONSchema()` — wrap with withJsonSchema if its library lacks
one). `clients` controls which non-browser surfaces (mcp / cli) expose this
socket; browser is the historical default. All server-only state the bundler
strips out of the client stub.
*/
export type SocketOptions<Schema extends StandardSchemaV1 = StandardSchemaV1> = {
    tail?: number
    ttl?: number
    clientPublish?: boolean
    schema?: Schema
    clients?: Partial<ClientFlags>
}
