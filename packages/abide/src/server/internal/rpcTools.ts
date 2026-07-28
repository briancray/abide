// rpcTools — project an app's RPCs into an `AgentSurface` (agent.md AG1.4 / AG2.2). Each RPC becomes
// an `AgentTool`: the name is the route name, the `inputSchema` is the registry's resolved input
// schema (MS1.3 — a raw JSON Schema as-is, a Standard Schema left off until a build step derives one),
// and `run` calls the RPC in-process so the call flows through the same handler (and, for reads, the
// same memo) as any request.
//
// This is the mapping the app-config default surface is built from — ALL `clients.mcp` RPCs (MS2.6),
// which is why it reads `buildRegistry` rather than the raw routes. It used to walk `route.__rpc`
// itself, with its own schema test and its own doc-string extraction, and the cost was exactly what
// ADR 0027 D9 predicts of a surface that re-derives instead of reading the normalizer: it never
// consulted `clients` at all, so `clients: { mcp: false }` (and `clients: false`) were honoured on
// OpenAPI, MCP, the CLI, the client bundle and channel-tag auth, and silently IGNORED here — the one
// surface where the caller is a model choosing what to invoke.
//
// It is kept separate from `agent()` so the loop stays usable with no app config at all.

import type { AgentSurface, AgentTool } from './agentTypes.ts'
import type { Mutation, Rpc } from './makeRpc.ts'
import { buildRegistry } from './registry.ts'
import type { AppConfig } from './router.ts'

export function rpcTools(config: AppConfig): AgentSurface {
    const routes = config.routes ?? {}
    const surface: AgentSurface = []
    for (const entry of buildRegistry(config).rpcs) {
        // Reachability, not authorization (CLAUDE.md): an rpc withheld from the MCP surface is withheld
        // from the agent's tool set, which IS the MCP tool set by definition (MS2.6). Its middleware
        // still runs on every call that does happen.
        if (entry.clients.mcp === false) continue
        const route = routes[entry.name]
        if (route === undefined) continue
        const tool: AgentTool = {
            name: entry.name,
            // Reads go through the memo (load resolves the cached/coalesced value); mutations call directly.
            run: (args: unknown): Promise<unknown> =>
                entry.read
                    ? (route as unknown as Rpc<unknown, unknown>)(args)
                    : (route as unknown as Mutation<unknown, unknown>)(args),
        }
        if (entry.doc !== undefined) tool.description = entry.doc
        if (entry.inputSchema !== undefined) tool.inputSchema = entry.inputSchema
        surface.push(tool)
    }
    return surface
}
