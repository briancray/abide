import type { Clients, Registry, RpcEntry, SocketEntry } from './registry.ts'

// SURFACE PROJECTION — "what does a caller of kind X see?", asked once.
//
// A SURFACE is a projection of the app's registry for one kind of caller: HTTP/OpenAPI, MCP, the CLI
// command table, the client bundle, an agent's tool list, a tag channel's join gate. `registry.ts`
// owns the NORMALISATION of the authored `clients` option (`resolveClients`) and stopped there — so
// downstream there were nine independent `entry.clients.X === false` checks across six modules, each
// re-deciding the same question next to code that varies for real.
//
// The nine were not equally harmless. `mcp.ts` spelled the predicate FOUR times, and two of those pairs
// have to agree or the surface lies: the rpc LIST (`mcpTools`) and the rpc DISPATCH (`callMcpTool`) must
// admit the same set, and likewise for sockets. Drift there advertises a tool that answers "unknown
// tool", or leaves one reachable that was never advertised — and nothing tied the two loops together.
//
// So the GATE and the LOOP live here. What does NOT is the shape each surface renders, because that
// genuinely differs: a read's args become query parameters in OpenAPI, `--flags` on the CLI, and a JSON
// Schema for a model. Folding those together would be a worse module than the nine checks.
//
// The other thing this file makes visible rather than uniform is the missing-input-schema fallback. It
// has four answers and they LOOKED accidental; three are protocol requirements and only the fourth is a
// choice. They are named below so the next reader can tell which is which instead of picking one.

// Which surface is asking. The same three names `resolveClients` normalises, so a surface cannot be
// spelled here that the authoring side does not accept.
export type SurfaceKind = keyof Clients

// Does this callable reach `surface`? THE gate — reachability, never authorization (auth is
// `middleware`, which runs per read and can short-circuit; this decides only what is GENERATED).
//
// All flags default ON: absent means reachable, and only an explicit `false` withholds. That default is
// why the predicate is worth naming — `!entry.clients[surface]` reads like the same question and is
// wrong for every callable that never mentioned `clients`.
export function reaches(entry: { clients: Clients }, surface: SurfaceKind): boolean {
    return entry.clients[surface] !== false
}

// The rpcs `surface` may see. The list a projection iterates, so a surface that both LISTS and
// DISPATCHES gets one set rather than two loops that have to agree.
export function rpcsFor(registry: Registry, surface: SurfaceKind): RpcEntry[] {
    const reachable: RpcEntry[] = []
    for (let index = 0; index < registry.rpcs.length; index += 1) {
        const entry = registry.rpcs[index]
        if (entry !== undefined && reaches(entry, surface)) reachable.push(entry)
    }
    return reachable
}

// The sockets `surface` may see. Same argument as `rpcsFor`; `mcp.ts` needs both.
export function socketsFor(registry: Registry, surface: SurfaceKind): SocketEntry[] {
    const reachable: SocketEntry[] = []
    for (let index = 0; index < registry.sockets.length; index += 1) {
        const entry = registry.sockets[index]
        if (entry !== undefined && reaches(entry, surface)) reachable.push(entry)
    }
    return reachable
}

// WHAT AN ABSENT INPUT SCHEMA PROJECTS AS, per surface. Four answers, and the difference is real:
//
//   OpenAPI   `{}`               — JSON Schema's "any value". A spec must describe the parameter, and
//                                  the honest description of an underived one is "unconstrained".
//   MCP       `{ type: 'object' }` — REQUIRED by the MCP spec: a tool's `inputSchema` must be an object
//                                  schema, so `{}` is not a legal answer here even though it means the
//                                  same thing.
//   agent     omitted            — `AgentTool.inputSchema` is optional, and an engine treats absence as
//                                  "no declared shape". Sending `{}` would instead declare an empty
//                                  object, i.e. "takes no arguments", which is the opposite.
//   CLI       `schemaKnown: false` — not a schema at all but a PARSER MODE: with no enumerated fields
//                                  the parser accepts any flag rather than rejecting what it cannot see.
//
// Named here so a fifth surface picks one deliberately, and so the three that are forced are visibly
// forced. Deliberately NOT unified — a single answer would be wrong on at least two surfaces.
export const ANY_VALUE_SCHEMA: Record<string, unknown> = {}
export const ANY_OBJECT_SCHEMA: Record<string, unknown> = { type: 'object' }

// A SOCKET'S MCP TOOL NAMES. The `<name>_tail` / `<name>_publish` convention is a wire contract between
// the tool LIST and the tool DISPATCH, and `mcp.ts` spelled it at four literal sites across the two
// loops. That module's own header names the failure this invites — "advertises a tool that answers
// 'unknown tool', or leaves one reachable that was never advertised" — and it was fixed for the SET the
// two loops iterate (both take `socketsFor(registry, 'mcp')`) but not for the NAMES they derive from it.
export function socketToolNames(name: string): { tail: string; publish: string } {
    return { tail: `${name}_tail`, publish: `${name}_publish` }
}
