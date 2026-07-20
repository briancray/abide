// rpcTools — project a set of app RPCs into an `AgentSurface` (agent.md AG1.4 / AG2.2). Each RPC
// becomes an `AgentTool`: the name is the route name, the `inputSchema` is the RPC's declared input
// schema (MS2 tool schema, when it is a raw JSON Schema), and `run` calls the RPC in-process so the
// call flows through the same handler (and, for reads, the same cell) as any request.
//
// This is the mapping the app-config default surface is built from (all `clients.mcp` RPCs); it is
// kept separate from agent() so the loop stays usable without any app config.

import type { AgentSurface, AgentTool } from "./agentTypes.ts";
import type { Route } from "./router.ts";
import type { Rpc, Mutation } from "./makeRpc.ts";
import type { JSONSchema } from "../../shared/internal/jsonSchema.ts";

// A value already IS a JSONSchema if it's an object without a Standard Schema marker. Standard
// Schemas are left off (their JSON Schema needs a build-time derivation step, MS1.3).
function asJsonSchema(schema: unknown): JSONSchema | undefined {
  if (typeof schema !== "object" || schema === null) return undefined;
  if ("~standard" in schema) return undefined;
  return schema as JSONSchema;
}

function toTool(name: string, route: Route): AgentTool {
  const meta = route.__rpc;
  const tool: AgentTool = {
    name,
    // Reads go through the cell (load resolves the cached/coalesced value); mutations call directly.
    run: (args: unknown): Promise<unknown> =>
      meta.read ? (route as Rpc<unknown, unknown>).load(args) : (route as Mutation<unknown, unknown>)(args),
  };
  if (typeof meta.options.doc === "string" && meta.options.doc.length > 0) tool.description = meta.options.doc;
  const inputSchema = asJsonSchema(meta.options.schemas?.input);
  if (inputSchema !== undefined) tool.inputSchema = inputSchema;
  return tool;
}

export function rpcTools(rpcs: Record<string, Route>): AgentSurface {
  const surface: AgentSurface = [];
  for (const name in rpcs) {
    surface.push(toTool(name, rpcs[name]!));
  }
  return surface;
}
