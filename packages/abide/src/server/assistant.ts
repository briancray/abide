// SECTION 45 — A CONVERSATION WITH A MODEL, piped through a handler the app wrote. `assistant` is what
// every provider shares: the transcript's check, the app's MCP tools as a `Toolbox`, and the turn cap.
// A `Provider` runs the conversation — `claudeApi` by looping over the Messages API itself,
// `claudeCode` by handing it to a Claude Code on the visitor's own machine — and yields the one
// `AssistantEvent` stream either way (45.2).
//
// THE TOOLS ARE THE APP'S OWN MCP SURFACE (45.6), called in process through the app answering this
// request and carrying the asker's credentials (45.7), so a tool does what the person asking could do
// and nothing more. Both are CAPTURED when the conversation starts: a provider may call a tool from
// another request's scope — `claudeCode` answers one from the bridge's — and the call is still this
// asker's.

import { refuse } from '#shared/refuse.ts'
import { type McpReply, McpSurface } from './generatedSurfaces.ts'
import { request, within } from './requestScope.ts'

/** One turn of the transcript a caller sends. */
export type AssistantMessage = { role: 'user' | 'assistant'; content: string }

/** What a conversation yields, the same from every provider. */
export type AssistantEvent =
    | { type: 'text'; text: string }
    | { type: 'tool'; id: string; name: string; input: unknown }
    | { type: 'result'; id: string; text: string; failed: boolean }
    | {
          type: 'done'
          stop: string
          usage: { input: number; output: number }
      }

/** A tool as the app's MCP surface lists it. */
export type ToolDefinition = {
    name: string
    description: string
    inputSchema: unknown
}

/** The app's MCP tools, called as the asker. */
export type Toolbox = {
    list: ToolDefinition[]
    call(
        name: string,
        input: unknown,
    ): Promise<{ text: string; failed: boolean }>
}

/** What runs a conversation: a model's API, or something that runs its own loop. */
export type Provider = {
    run(
        messages: AssistantMessage[],
        tools: Toolbox,
        limits: { maxTurns: number; signal: AbortSignal },
    ): AsyncGenerator<AssistantEvent>
}

/** What `assistant` takes beside a provider, the same for every one. */
export type AssistantOptions = { mcp?: boolean; maxTurns?: number }

const MAX_TURNS = 10
// 45.7 — the caller's credentials, and nothing else of their request.
const CARRIED_HEADERS = ['cookie', 'authorization']

/** A conversation over `messages`, run by `provider`, as the events it produces. */
export async function* assistant(
    messages: AssistantMessage[],
    provider: Provider,
    options: AssistantOptions = {},
): AsyncGenerator<AssistantEvent> {
    // 45.3 — a transcript a model can answer ends on the asker's turn.
    if (messages.at(-1)?.role !== 'user')
        throw refuse(
            400,
            'The transcript has to end on a user turn for the assistant to answer it. RULEBOOK 45.3.',
        )
    const tools = toolboxOver(
        options.mcp === true ? appSurface() : NO_SURFACE,
        askerOf(request()),
    )
    yield* provider.run(messages, tools, {
        maxTurns: options.maxTurns ?? MAX_TURNS,
        signal: request().signal,
    })
}

/** Where an MCP request is answered, as JSON-RPC's `result` or `error`. */
type McpForward = (method: string, params: unknown) => Promise<McpReply>

// WHAT A `Toolbox` FORWARDS AN MCP REQUEST TO, for a provider that speaks MCP itself (`claudeCode`):
// the app's own surface, verbatim, rather than a second server rebuilt over `list` and `call`. Beside
// the type rather than on it, since a `Toolbox` is public and this is not.
const FORWARDS = new WeakMap<Toolbox, McpForward>()

/** Where `tools` sends an MCP request whole. 45.17. */
export function forwardOf(tools: Toolbox): McpForward {
    const forward = FORWARDS.get(tools)
    if (forward === undefined)
        throw new Error(
            'abide: an MCP request is answered from the Toolbox `assistant` built, and this one it did not.',
        )
    return forward
}

// Without `mcp` there is no surface to forward to, so this is the protocol over nothing — and
// nothing is published, so nothing is ever called.
const NO_SURFACE = new McpSurface(
    new Map(),
    async () => new Response(null, { status: 404 }),
)

/** The MCP surface of the app answering this request. 45.6, 45.8. */
function appSurface(): McpSurface {
    // 42.12 — the app answering this request, captured: a later call may come from another's scope.
    const app = within('assistant').app
    if (app === undefined)
        throw new Error(
            'abide: assistant tools are the app’s MCP surface, and no app is answering this request. RULEBOOK 45.6.',
        )
    // 45.8, 20.7 — asking for tools over a closed surface is a mistake to name.
    if (!app.mcp.opened)
        throw new Error(
            'abide: assistant was asked for tools, and ABIDE_MCP has not opened the MCP surface. RULEBOOK 45.8.',
        )
    return app.mcp
}

/** The asking request as a tool call is made: its credentials, and nothing else of it. 45.7. */
function askerOf(asked: Request): Request {
    const carried: Record<string, string> = {}
    for (const name of CARRIED_HEADERS) {
        const value = asked.headers.get(name)
        if (value !== null) carried[name] = value
    }
    return new Request(asked.url, { headers: carried })
}

/** `surface` as a `Toolbox`, every call made as `asker`. 45.6, 45.7. */
function toolboxOver(surface: McpSurface, asker: Request): Toolbox {
    const tools: Toolbox = {
        list: surface.list(),
        async call(name, input) {
            // A refusal or a missing tool is a failed result the model reads, never a thrown one.
            try {
                return await surface.call(name, input, asker)
            } catch (thrown) {
                return {
                    text:
                        thrown instanceof Error
                            ? thrown.message
                            : String(thrown),
                    failed: true,
                }
            }
        },
    }
    FORWARDS.set(tools, (method, params) =>
        surface.answer(
            method,
            params as Record<string, unknown> | undefined,
            asker,
        ),
    )
    return tools
}
