// rpcTools — project an app's RPCs into an `AgentSurface` (agent.md AG1.4 / AG2.2). Each RPC becomes
// an `AgentTool`: the name is the route name, the `inputSchema` is the registry's resolved input
// schema (MS1.3 — a raw JSON Schema as-is, a Standard Schema left off until a build step derives one),
// and `run` calls the RPC back through this app's own HTTP face (`callOwnRpc`).
//
// THROUGH THE ROUTER, not the callable. `run` used to invoke the rpc in-process, on the reasoning that
// the call then "flows through the same handler (and, for reads, the same memo) as any request" — true
// of the handler and the memo, and false of the request. `schemas.input` validation and the rpc's own
// `middleware` are composed by the ROUTER, so an in-process call had neither: the declared input schema
// was advertised to the model (below) and never enforced against what it sent back, and an rpc whose
// authorization IS its middleware ran unauthorized. That is a bad trade at every surface and a
// disqualifying one here, where the caller is a model and the args are its own output. Reached over the
// loopback all of it applies, and the memo still backs the read on the far side — nothing is lost but
// the false claim.
//
// This is also what keeps "reachability, not authorization" literally true (CLAUDE.md: "a tool that IS
// reachable still runs its middleware on every call"), and what keeps the agent surface honest about
// being the MCP tool set (MS2.6): MCP has always dispatched over the same loopback, so the two now share
// one door rather than differing on whether the app's own gates run.
//
// It is kept separate from `agent()` so the loop stays usable with no app config at all.

import {
    decodeStreamResponse,
    isStreamContentType,
} from '../../shared/internal/decodeStreamResponse.ts'
import { toHttpError } from '../../shared/internal/toHttpError.ts'
import type { AgentSurface, AgentTool } from './agentTypes.ts'
import { callOwnRpc } from './callOwnRpc.ts'
import type { RpcEntry } from './registry.ts'
import { buildRegistry } from './registry.ts'
import { currentScope } from './requestScope.ts'
import type { AppConfig } from './router.ts'

export function rpcTools(config: AppConfig, origin: string): AgentSurface {
    const surface: AgentSurface = []
    for (const entry of buildRegistry(config).rpcs) {
        // Reachability, not authorization (CLAUDE.md): an rpc withheld from the MCP surface is withheld
        // from the agent's tool set, which IS the MCP tool set by definition (MS2.6). Its middleware
        // still runs on every call that does happen — which is now enforced rather than asserted.
        if (entry.clients.mcp === false) continue
        const tool: AgentTool = {
            name: entry.name,
            run: (args: unknown): Promise<unknown> => runRpcTool(entry, args, origin),
        }
        if (entry.doc !== undefined) tool.description = entry.doc
        if (entry.inputSchema !== undefined) tool.inputSchema = entry.inputSchema
        surface.push(tool)
    }
    return surface
}

async function runRpcTool(entry: RpcEntry, args: unknown, origin: string): Promise<unknown> {
    // The identity of the request the agent run sits inside, when it sits inside one. Outside a scope
    // (a cron tick, an `abide run` script) the tool call is anonymous — see `callOwnRpc`.
    const response = await callOwnRpc(entry, args, origin, currentScope()?.request)
    // A rejection is a THROW, because `agent()` turns a throwing `run` into an error tool-result the
    // model reads and can correct from. Swallowing a 422 into a value would hand the model a "result"
    // for a call the app refused.
    if (!response.ok) throw await toHttpError(response)
    // A streaming rpc answers jsonl/sse. A model reads a VALUE, not a cursor, so drain the transcript
    // into an array — what `chunks()` means. Bounded by the rpc's own `timeout` (a progress deadline),
    // exactly as every other consumer of that stream is; this path invents no second bound.
    if (isStreamContentType(response.headers.get('content-type'))) {
        const chunks: unknown[] = []
        for await (const chunk of decodeStreamResponse(response)) chunks.push(chunk)
        return chunks
    }
    return await response.json()
}
