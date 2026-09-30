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

import { MCP_ADDRESS } from '#shared/ADDRESSES.ts'
import { mounted } from '#shared/mount.ts'
import { refuse } from '#shared/refuse.ts'
import { appIdentity } from './config.ts'
import { MCP_PROTOCOL_VERSION } from './MCP_PROTOCOL_VERSION.ts'
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
    const tools = options.mcp === true ? await appTools() : NO_TOOLS
    yield* provider.run(messages, tools, {
        maxTurns: options.maxTurns ?? MAX_TURNS,
        signal: request().signal,
    })
}

/** An MCP request answered as JSON-RPC's `result` or `error`, without the envelope. */
type McpForward = (
    method: string,
    params: unknown,
) => Promise<Record<string, unknown>>

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

const NO_TOOLS: Toolbox = {
    list: [],
    call: async (name) => ({ text: `No tool named ${name}.`, failed: true }),
}
// Without `mcp` there is no surface to forward to, so this is one with nothing on it.
FORWARDS.set(NO_TOOLS, async (method) => {
    if (method === 'initialize')
        return {
            result: {
                protocolVersion: MCP_PROTOCOL_VERSION,
                capabilities: { tools: {} },
                serverInfo: appIdentity(),
            },
        }
    if (method === 'ping') return { result: {} }
    if (method === 'tools/list') return { result: { tools: [] } }
    return { error: { code: -32601, message: `No method ${method}.` } }
})

type McpContent = { type: string; text?: string }

/** The text of an MCP content list. */
function textOf(content: McpContent[] | undefined): string {
    let text = ''
    for (const part of content ?? [])
        if (part.text !== undefined) text += part.text
    return text
}

/** The app's MCP surface as a `Toolbox`, bound to this request's app and asker. 45.6, 45.7. */
async function appTools(): Promise<Toolbox> {
    // 42.12 — the app answering this request, captured: a later call may come from another's scope.
    const answer = within('assistant').answer
    if (answer === undefined)
        throw new Error(
            'abide: assistant tools are the app’s MCP surface, and no app is answering this request. RULEBOOK 45.6.',
        )
    const asked = request()
    const url = new URL(mounted(MCP_ADDRESS), asked.url).href
    const carried: Record<string, string> = {
        'content-type': 'application/json',
    }
    for (const name of CARRIED_HEADERS) {
        const value = asked.headers.get(name)
        if (value !== null) carried[name] = value
    }
    const forward: McpForward = async (method, params) => {
        const answered = await answer(
            new Request(url, {
                method: 'POST',
                headers: carried,
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
            }),
        )
        // 45.8, 20.7 — a closed surface is a 404, and asking for tools over one is a mistake to name.
        if (answered.status === 404)
            throw new Error(
                'abide: assistant was asked for tools, and ABIDE_MCP has not opened the MCP surface. RULEBOOK 45.8.',
            )
        const reply = (await answered.json().catch(() => undefined)) as
            | { result?: unknown; error?: { message: string } }
            | undefined
        if (reply?.result === undefined && reply?.error === undefined)
            throw new Error(`the MCP endpoint answered ${answered.status}`)
        return { result: reply.result, error: reply.error }
    }
    const callMcp = async (
        method: string,
        params: Record<string, unknown>,
    ): Promise<Record<string, unknown>> => {
        const { result, error } = await forward(method, params)
        if (result === undefined)
            throw new Error((error as { message: string }).message)
        return result as Record<string, unknown>
    }
    const list = (await callMcp('tools/list', {})).tools as ToolDefinition[]
    const tools: Toolbox = {
        list,
        async call(name, input) {
            // A refusal or a missing tool is a failed result the model reads, never a thrown one.
            try {
                const result = await callMcp('tools/call', {
                    name,
                    arguments: input,
                })
                return {
                    text: textOf(result.content as McpContent[]),
                    failed: result.isError === true,
                }
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
    FORWARDS.set(tools, forward)
    return tools
}
