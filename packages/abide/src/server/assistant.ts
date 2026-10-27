// SECTION 45 — A CONVERSATION WITH A MODEL, piped through a handler the app wrote. `assistant` is what
// every provider shares: the transcript's check, the app's MCP tools as a `Toolbox`, and the turn cap.
// A `Provider` runs the conversation — `claudeApi` by looping over the Messages API itself,
// `claudeCode` by handing it to a Claude Code on the visitor's own machine — and yields the one
// `AssistantEvent` stream either way (44.2).
//
// THE TOOLS ARE THE APP'S OWN MCP SURFACE (44.6), called in process through the app answering this
// request and carrying the asker's credentials (44.7), so a tool does what the person asking could do
// and nothing more. Both are CAPTURED when the conversation starts: a provider may call a tool from
// another request's scope — `claudeCode` answers one from the bridge's — and the call is still this
// asker's.

import { namedLogger } from '#shared/log.ts'
import { refuse } from '#shared/refuse.ts'
import { IMAGE_TYPES } from './IMAGE_TYPES.ts'
import { type McpReply, McpSurface } from './generatedSurfaces.ts'
import { request, within } from './requestScope.ts'

/** A piece of a turn: words, or an image as base64 with its type. */
export type AssistantContent =
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }

/** One turn of the transcript a caller sends: its words, or its pieces in order. */
export type AssistantMessage = {
    role: 'user' | 'assistant'
    content: string | AssistantContent[]
}

/** What a conversation yields, the same from every provider. */
export type AssistantEvent =
    | { type: 'text'; text: string }
    | { type: 'tool'; id: string; name: string }
    | { type: 'input'; id: string; input: unknown }
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
    annotations: {
        readOnlyHint: boolean
        destructiveHint: boolean
        idempotentHint: boolean
    }
    outputSchema: unknown
}

/** What a tool call answered: its pieces, and whether it failed. 20.21, 44.35. */
export type ToolAnswer = { content: AssistantContent[]; failed: boolean }

/** The app's MCP tools, called as the asker. */
export type Toolbox = {
    list: ToolDefinition[]
    call(name: string, input: unknown): Promise<ToolAnswer>
}

/** What runs a conversation: a model's API, or something that runs its own loop. */
export type Provider = {
    run(
        messages: (AssistantMessage & { content: AssistantContent[] })[],
        tools: Toolbox,
        limits: { maxTurns: number; signal: AbortSignal },
    ): AsyncGenerator<AssistantEvent>
}

/** What `assistant` takes beside a provider, the same for every one. */
export type AssistantOptions = { mcp?: boolean; maxTurns?: number }

const MAX_TURNS = 10
const ASSISTANT_LOG = namedLogger('abide:assistant')
// 44.7 — the caller's credentials, and nothing else of their request.
const CARRIED_HEADERS = ['cookie', 'authorization']

/** A conversation over `messages`, run by `provider`, as the events it produces. */
export async function* assistant(
    messages: AssistantMessage[],
    provider: Provider,
    options: AssistantOptions = {},
): AsyncGenerator<AssistantEvent> {
    // 44.3 — a transcript a model can answer ends on the asker's turn.
    if (messages.at(-1)?.role !== 'user')
        throw refuse(
            400,
            'The transcript has to end on a user turn for the assistant to answer it. RULEBOOK 44.3.',
        )
    // Every turn as its pieces, so a provider reads one shape: words alone are one text piece.
    const turns: Parameters<Provider['run']>[0] = []
    for (const message of messages) {
        if (typeof message.content === 'string') {
            turns.push({
                role: message.role,
                content: [{ type: 'text', text: message.content }],
            })
            continue
        }
        turns.push({ role: message.role, content: message.content })
        for (const piece of message.content) {
            if (piece?.type !== 'image') continue
            // 44.37 — an image is the asker's to show, never a turn the model answered.
            if (message.role !== 'user')
                throw refuse(
                    400,
                    'An image can only stand in a user turn of the transcript. RULEBOOK 44.37.',
                )
            // 44.36.
            if (!IMAGE_TYPES.has(piece.mimeType))
                throw refuse(
                    400,
                    `An image in the transcript is ${piece.mimeType}, and a model is shown only ${[...IMAGE_TYPES].join(', ')}. RULEBOOK 44.36.`,
                )
        }
    }
    const tools = toolboxOver(
        options.mcp === true ? appSurface() : NO_SURFACE,
        askerOf(request()),
    )
    const events = provider.run(turns, tools, {
        maxTurns: options.maxTurns ?? MAX_TURNS,
        signal: request().signal,
    })
    // 28.7 — a closed namespace runs the provider's stream untouched.
    yield* ASSISTANT_LOG.enabled() ? traced(events, messages.length) : events
}

/** `events`, and one line on `abide:assistant` once they end, however they end. 44.31. */
async function* traced(
    events: AsyncGenerator<AssistantEvent>,
    messageCount: number,
): AsyncGenerator<AssistantEvent> {
    const started = performance.now()
    let calls = 0
    let done: Extract<AssistantEvent, { type: 'done' }> | undefined
    try {
        for await (const event of events) {
            if (event.type === 'tool') calls += 1
            else if (event.type === 'done') done = event
            yield event
        }
    } finally {
        ASSISTANT_LOG.debug(
            done === undefined ? 'unfinished' : done.stop,
            `${messageCount} messages`,
            `${calls} tool calls`,
            done === undefined
                ? 'no usage'
                : `${done.usage.input}/${done.usage.output} tokens`,
            `${(performance.now() - started).toFixed(1)}ms`,
        )
    }
}

/** Where an MCP request is answered, as JSON-RPC's `result` or `error`. */
type McpForward = (method: string, params: unknown) => Promise<McpReply>

// WHAT A `Toolbox` FORWARDS AN MCP REQUEST TO, for a provider that speaks MCP itself (`claudeCode`):
// the app's own surface, verbatim, rather than a second server rebuilt over `list` and `call`. Beside
// the type rather than on it, since a `Toolbox` is public and this is not.
const FORWARDS = new WeakMap<Toolbox, McpForward>()

/** Where `tools` sends an MCP request whole. 44.17. */
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

/** The MCP surface of the app answering this request. 44.6, 44.8. */
function appSurface(): McpSurface {
    // 42.12 — the app answering this request, captured: a later call may come from another's scope.
    const app = within('assistant').app
    if (app === undefined)
        throw new Error(
            'abide: assistant tools are the app’s MCP surface, and no app is answering this request. RULEBOOK 44.6.',
        )
    // 44.8, 20.7 — asking for tools where no handler is published to MCP is a mistake to name.
    if (!app.mcp.opened)
        throw new Error(
            'abide: assistant was asked for tools, and this app publishes no handler to MCP. RULEBOOK 44.8.',
        )
    return app.mcp
}

/** The asking request as a tool call is made: its credentials, and nothing else of it. 44.7. */
function askerOf(asked: Request): Request {
    const carried: Record<string, string> = {}
    for (const name of CARRIED_HEADERS) {
        const value = asked.headers.get(name)
        if (value !== null) carried[name] = value
    }
    return new Request(asked.url, { headers: carried })
}

/** `surface` as a `Toolbox`, every call made as `asker`. 44.6, 44.7. */
function toolboxOver(surface: McpSurface, asker: Request): Toolbox {
    const tools: Toolbox = {
        list: surface.list(),
        async call(name, input) {
            // A refusal or a missing tool is a failed result the model reads, never a thrown one.
            try {
                return await surface.call(name, input, asker)
            } catch (thrown) {
                return {
                    content: [
                        {
                            type: 'text',
                            text:
                                thrown instanceof Error
                                    ? thrown.message
                                    : String(thrown),
                        },
                    ],
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

/**
 * Pieces as Messages API blocks, in order: text as text, an image as base64 with its type. A text of
 * whitespace alone is left out, as the API refuses one. 44.38.
 */
export function blocksOf(content: AssistantContent[]): unknown[] {
    const blocks: unknown[] = []
    for (const piece of content)
        if (piece.type === 'image')
            blocks.push({
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: piece.mimeType,
                    data: piece.data,
                },
            })
        else if (/\S/.test(piece.text))
            blocks.push({ type: 'text', text: piece.text })
    return blocks
}

/** The words of `content`, its images left out. */
export function textOf(content: AssistantContent[]): string {
    let text = ''
    for (const piece of content) if (piece.type === 'text') text += piece.text
    return text
}
