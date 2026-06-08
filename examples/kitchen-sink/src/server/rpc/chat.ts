import { agent } from '@belte/belte/server/agent'
import { jsonl } from '@belte/belte/server/jsonl'
import { POST } from '@belte/belte/server/POST'
import { engine } from '@belte/claude-code'
import { z } from 'zod'

/*
Chat agent over the Claude Code engine. `agent(engine, messages)` runs the
engine against this app's own MCP surface — every schema-bearing, mcp-exposed
verb (getProduct, getRates, countLog, …) is a tool the model may call — and
returns its AgentFrame stream. The handler frames it with `jsonl()`, so the
browser reads it line-by-line like any other streaming rpc.

Claude Code authenticates with whatever it's logged in with (a subscription or
an API key), so there's no key in `$server/config` — the host running the
server must have Claude Code available.

This demo lets the page pick Claude Code's `permissionMode` so you can watch
the posture change (whether the model may run tools, only plan, etc.). In a
real app you'd fix the mode here server-side rather than accept it from the
client — permission is the server's call.
*/

// Mirrors NeutralMessage from belte/server/agent — the provider-neutral turn shape.
const message = z.discriminatedUnion('role', [
    z.object({ role: z.literal('user'), text: z.string() }),
    z.object({
        role: z.literal('assistant'),
        text: z.string().optional(),
        toolUses: z
            .array(z.object({ id: z.string(), name: z.string(), input: z.unknown() }))
            .optional(),
    }),
    z.object({
        role: z.literal('tool'),
        results: z.array(
            z.object({ id: z.string(), content: z.string(), isError: z.boolean().optional() }),
        ),
    }),
])

// The permission modes the demo exposes — a subset of the engine's PermissionMode.
const PERMISSION_MODES = ['default', 'plan', 'acceptEdits', 'dontAsk', 'bypassPermissions'] as const

const inputSchema = z.object({
    messages: z.array(message),
    mode: z.enum(PERMISSION_MODES).default('default'),
})

/*
POST with a schema but no explicit `clients.mcp`, so it stays off the MCP
surface — the agent verb is never itself a tool, which keeps the agent from
being handed a tool that re-enters the agent. `clients.cli` is off too: a
messages-array turn isn't a meaningful CLI subcommand. Browser-only.
*/
export const chat = POST(
    ({ messages, mode }) => jsonl(agent(engine({ permissionMode: mode }), messages)),
    { inputSchema, clients: { cli: false } },
)
