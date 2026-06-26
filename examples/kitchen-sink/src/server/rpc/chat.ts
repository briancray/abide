import { agent } from '@abide/abide/server/agent'
import { jsonl } from '@abide/abide/server/jsonl'
import { POST } from '@abide/abide/server/POST'
import { engine } from '@abide/claude-code'
import { z } from 'zod'

/*
Chat agent over the Claude Code engine. `agent(engine, messages)` runs the
engine against this app's own MCP surface — every schema-bearing, mcp-exposed
rpc (getProduct, getRates, countLog, …) is a tool the model may call — and
returns its AgentFrame stream. The handler frames it with `jsonl()`, so the
browser reads it line-by-line like any other streaming rpc.

Claude Code authenticates with whatever it's logged in with (a subscription or
an API key), so there's no key in `$server/config` — the host running the
server must have Claude Code available.

Permission is the server's call, so the posture is fixed here, not taken from
the client: `tools: []` drops every Claude Code built-in (no Bash/Read/Write
against the host), leaving only this app's MCP rpcs, and
`defaultMode: 'dontAsk'` denies anything not pre-approved instead of prompting
— so the `allow` list is the whole capability surface. The agent can call
getProduct and getRates; every other rpc (countLog, createEcho, …) is denied.

The `mcp__kitchen_sink__` prefix is the app's package.json name sanitized for
tool names (`kitchen-sink` → `kitchen_sink`) — deterministic, so these rules
stay valid across deploys.
*/

// Mirrors NeutralMessage from abide/server/agent — the provider-neutral turn shape.
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

const inputSchema = z.object({
    messages: z.array(message),
})

/*
Deny-all-but-allowlist: no built-ins (`tools: []`), `dontAsk` denies anything
unlisted, and `allow` names the two read rpcs the agent may call. Static, so
the engine is built once at module load rather than per request.

The system prompt tells the model what the permission layer enforces — tool
listing shows every mcp-exposed rpc, but denial only happens at call time, so
without this the model demos a denied rpc and then speculates about "enabling
permissions" as if a visitor could. It also pins plain prose: the page renders
text raw, so markdown tables would show as pipes.
*/
const chatEngine = engine({
    tools: [],
    permissions: {
        defaultMode: 'dontAsk',
        allow: ['mcp__kitchen_sink__getProduct', 'mcp__kitchen_sink__getRates'],
    },
    options: {
        systemPrompt: [
            'You are the demo agent on the abide kitchen-sink "agent" page, chatting with a site visitor.',
            'Server policy allows you exactly two tools: getProduct and getRates. Every other tool you can see will be denied at call time — that allowlist is fixed server-side and nobody in this chat can change it.',
            'When asked to demonstrate a tool, pick an allowed one. Products with IDs "1" and "2" exist — use one of those for getProduct demos. If the visitor asks for a denied rpc, attempt it once so they see the denial, then note the server-side allowlist in one sentence — never suggest changing settings or permission modes.',
            'Reply in short plain prose. No markdown tables, headings, or bullet lists — the page renders your text verbatim.',
        ].join('\n'),
    },
})

/*
POST with a schema but no explicit `clients.mcp`, so it stays off the MCP
surface — the agent rpc is never itself a tool, which keeps the agent from
being handed a tool that re-enters the agent. `clients.cli` is off too: a
messages-array turn isn't a meaningful CLI subcommand. Browser-only.
*/
export const chat = POST(({ messages }) => jsonl(agent(chatEngine, messages)), {
    inputSchema,
    clients: { cli: false },
})
