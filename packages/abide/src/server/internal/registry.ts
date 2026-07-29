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
import { rpcMemoPolicy } from '../../shared/internal/rpcMemoPolicy.ts'
import type { RpcSpec } from '../../shared/internal/rpcSpec.ts'
import { jsonSchemaOf } from '../../shared/internal/shapeToSchema.ts'
import { log } from '../../shared/log.ts'
import { clientPublishAllowed } from '../socket.ts'
import type { AppConfig, Route } from './router.ts'

// Per-surface exposure flags (§13.3). All default-on: an absent flag means "exposed". Only an
// explicit `false` withholds a surface (e.g. `clients.browser === false` → omitted from OpenAPI).
export interface Clients {
    browser?: boolean
    mcp?: boolean
    cli?: boolean
}

// The AUTHORED shape of the `clients` option — REACHABILITY only (which surfaces reach this callable),
// never authorization; auth is `middleware`, which runs per-request and can short-circuit. These flags
// gate surface GENERATION (OpenAPI omission, MCP tool list, CLI registration, client-bundle inclusion),
// which is a different mechanism at a different time.
//
// Typed as of ADR 0027 D9. It was `unknown`, and an untyped public option plus a silently-lenient
// normalizer is exactly how a documented feature evaporates: neither the compiler nor a dead-field scan
// can see a shape nobody declared. Two documented behaviours had rotted behind it — see `resolveClients`.
export type ClientsOption = boolean | Clients

// The bilateral half is `RpcSpec` — the fields that cross into the client bundle, declared once so
// the six places that used to spell them cannot disagree (they had: `throttle`/`debounce` were missing
// from one). What is added here is BUILD-ONLY: it never reaches the browser.
export interface RpcEntry extends RpcSpec {
    name: string
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
    // `maxAge` (ms; Infinity = sticky) windows `peek()`.
    tail: number
    maxAge: number
    clients: Clients
}

export interface Registry {
    rpcs: RpcEntry[]
    sockets: SocketEntry[]
}

// The three surfaces a callable can be reachable from. Named once so the normalizer can both READ them
// and recognise anything that is NOT one of them.
const CLIENT_SURFACES = ['browser', 'mcp', 'cli'] as const

// Normalise the authored `clients` option into the flat `Clients` shape.
//
// ADR 0027 D9 fixed two documented behaviours that silently did nothing here, both caused by the same
// shape: the option was typed `unknown`, and this function ignored whatever it did not recognise.
//
//  1. `clients: false` — documented in CLAUDE.md as one of the three accepted values, but `typeof false
//     !== 'object'` fell into the "all surfaces on" branch, so it meant the exact OPPOSITE of what it
//     said. It now withholds all three. (This is still not authorization: the raw HTTP endpoint remains
//     — what is withheld is generation/advertisement on the three client surfaces.)
//  2. `clients: { browser: { validate: … } }` — advertised as shipping the real validator client-side
//     for parity, never implemented. RETRACTED rather than built: `clients` is reachability, and
//     shipping a validator is a BUNDLING decision that belongs next to `schemas`. A nested object now
//     warns instead of being dropped in silence.
//
// Unrecognised input is LOUD (`abide:rpc`) rather than dropped — that silence is what let both rot.
function resolveClients(raw: unknown, label: string): Clients {
    if (raw === undefined || raw === true) return {} // absent / explicit `true` → every surface on
    if (raw === false) return { browser: false, mcp: false, cli: false }
    if (typeof raw !== 'object' || raw === null) {
        log.channel('abide:rpc').warn(
            `${label}: \`clients\` must be a boolean or { browser?, mcp?, cli? } — got ${typeof raw}. Ignoring.`,
        )
        return {}
    }
    const source = raw as Record<string, unknown>
    const clients: Clients = {}
    for (const surface of CLIENT_SURFACES) {
        const value = source[surface]
        if (value === undefined) continue
        if (typeof value === 'boolean') {
            clients[surface] = value
            continue
        }
        log.channel('abide:rpc').warn(
            `${label}: \`clients.${surface}\` must be a boolean — got ${typeof value}. Ignoring (the surface stays reachable). ` +
                `NB: \`clients.browser: { validate }\` was retracted in ADR 0027 D9 — \`clients\` is reachability, not bundling.`,
        )
    }
    for (const key of Object.keys(source)) {
        if (!(CLIENT_SURFACES as readonly string[]).includes(key)) {
            log.channel('abide:rpc').warn(
                `${label}: unknown \`clients.${key}\` — expected one of ${CLIENT_SURFACES.join(', ')}. Ignoring.`,
            )
        }
    }
    return clients
}

function rpcEntry(name: string, route: Route): RpcEntry {
    const meta = route.__rpc
    const options = meta.options
    const schemas = options.schemas

    // The memo half of the entry is the normalized POLICY verbatim (`shared/internal/rpcMemoPolicy`) —
    // the same call `makeRpc` makes to build the server memo, so the wire carries the server's answer
    // instead of a second derivation of it. It used to be a second derivation, and it disagreed: a
    // `memo: false` READ shipped `ttl: null` (Infinity) while the server ran that read at `ttl: 0`.
    const policy = rpcMemoPolicy(options.memo, meta.read)

    const entry: RpcEntry = {
        name,
        method: meta.method,
        read: meta.read,
        crossRequest: policy.crossRequest,
        memo: policy.memoed,
        ttl: policy.ttl,
        timeout: meta.timeout,
        clients: resolveClients(options.clients, `rpc "${name}"`),
    }

    if (policy.tags !== undefined) entry.tags = policy.tags
    if (policy.throttle !== undefined) entry.throttle = policy.throttle
    if (policy.debounce !== undefined) entry.debounce = policy.debounce

    const inputSchema = jsonSchemaOf(schemas?.input)
    if (inputSchema !== undefined) entry.inputSchema = inputSchema

    const outputSchema = jsonSchemaOf(schemas?.output)
    if (outputSchema !== undefined) entry.outputSchema = outputSchema

    if (typeof options.doc === 'string' && options.doc.length > 0) entry.doc = options.doc

    return entry
}

// Derived once per (routes, sockets) pair. The registry is a pure projection of an immutable config,
// but it was re-derived on every `/openapi.json` hit, twice per MCP `tools/call`, and twice per client
// build — and `resolveClients` warns as it goes, so an unrecognized `clients` key was reported twice
// per build. Keyed on the two FIELDS rather than on the config object: `abide dev` reassigns
// `config.routes`/`config.sockets` in place on reload (`cli/serve.ts`), which a `WeakMap<AppConfig>`
// would not see.
const REGISTRY_CACHE = new WeakMap<
    AppConfig,
    { routes: unknown; sockets: unknown; registry: Registry }
>()

export function buildRegistry(config: AppConfig): Registry {
    const cached = REGISTRY_CACHE.get(config)
    if (
        cached !== undefined &&
        cached.routes === config.routes &&
        cached.sockets === config.sockets
    )
        return cached.registry
    const registry = deriveRegistry(config)
    REGISTRY_CACHE.set(config, { routes: config.routes, sockets: config.sockets, registry })
    return registry
}

function deriveRegistry(config: AppConfig): Registry {
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
            clientPublish: clientPublishAllowed(options.clientPublish),
            // The channel's own options (ADR 0027 D1), carried under the channel's own name the whole
            // way to the browser. The wire spec used to call this `ttl`, which put the one word the
            // rename exists to avoid back into the payload — and left `socketSpecs`/`SocketSpec`
            // reading like a memo retention knob when it is a per-MESSAGE age window.
            tail: typeof options.channel?.tail === 'number' ? options.channel.tail : 0,
            maxAge: typeof options.channel?.maxAge === 'number' ? options.channel.maxAge : Infinity,
            clients: resolveClients(options.clients, `socket "${name}"`),
        }
        const messageSchema = jsonSchemaOf(options.schema)
        if (messageSchema !== undefined) entry.messageSchema = messageSchema
        sockets.push(entry)
    }

    return { rpcs, sockets }
}
