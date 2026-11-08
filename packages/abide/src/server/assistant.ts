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

import type {
    AssistantContent,
    AssistantEvent,
    AssistantMessage,
} from '#shared/AssistantEvent.ts'
import { IMAGE_TYPES } from '#shared/IMAGE_TYPES.ts'
import { namedLogger } from '#shared/log.ts'
import { mounted } from '#shared/mount.ts'
import { refuse } from '#shared/refuse.ts'

import { type McpReply, McpSurface } from './generatedSurfaces.ts'
import { request, within } from './requestScope.ts'
import type { Listed } from './surfaceOf.ts'

/**
 * An `AssistantEvent` as a `Provider` yields it: a tool call named, and its result in words, with what
 * `assistant` reads off the app's own surface for both — the handler, and the value — still to come.
 */
export type ProviderEvent =
    | Exclude<AssistantEvent, { type: 'tool' | 'result' }>
    | { type: 'tool'; id: string; name: string }
    | { type: 'result'; id: string; text: string; failed: boolean }

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
    ): AsyncGenerator<ProviderEvent>
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
    const surface = options.mcp === true ? appSurface() : NO_SURFACE
    const tools = toolboxOver(surface, askerOf(request()))
    const signal = request().signal
    const events = provider.run(turns, tools, {
        maxTurns: options.maxTurns ?? MAX_TURNS,
        signal,
    })
    // 28.7 — a closed namespace pays for no line.
    yield* ASSISTANT_LOG.enabled()
        ? traced(read(events, surface), messages.length, signal)
        : read(events, surface)
}

/** A called tool's handler, and whether its answer is a value read as JSON (19.21). */
type Called = {
    handler: { method: Listed['method']; address: string } | undefined
    valued: boolean
}

const NOT_THE_APPS: Called = { handler: undefined, valued: false }

/**
 * `events` with each call's handler, and each answer's value, read off `surface`. 44.48, 44.49.
 *
 * READ HERE RATHER THAN BY EACH PROVIDER, so a provider the app wrote yields the same events abide's
 * do (44.2): a provider names the tool as the `Toolbox` lists it (44.50), and the rest is the surface's.
 */
async function* read(
    events: AsyncGenerator<ProviderEvent>,
    surface: McpSurface,
): AsyncGenerator<AssistantEvent> {
    const calls = new Map<string, Called>()
    for await (const event of events) {
        if (event.type === 'tool') {
            const tool = surface.tool(event.name)
            const called: Called =
                tool === undefined
                    ? NOT_THE_APPS
                    : {
                          // 16.10 — the address an `Rpc` carries, under the mount.
                          handler: {
                              method: tool.method,
                              address: mounted(tool.address),
                          },
                          valued: tool.result !== undefined,
                      }
            calls.set(event.id, called)
            yield {
                type: 'tool',
                id: event.id,
                name: event.name,
                handler: called.handler,
            }
        } else if (event.type === 'result') {
            const called = calls.get(event.id) ?? NOT_THE_APPS
            yield {
                type: 'result',
                id: event.id,
                text: event.text,
                failed: event.failed,
                handler: called.handler,
                value:
                    called.valued && !event.failed
                        ? valueOf(event.text)
                        : undefined,
            }
        } else yield event
    }
}

/** An answer's words as the JSON value they spell, or `undefined` where they spell none. */
function valueOf(text: string): unknown {
    try {
        return JSON.parse(text)
    } catch {
        return undefined
    }
}

/**
 * `events`, and one line on `abide:assistant` once they end, however they end. 44.31.
 *
 * AN UNFINISHED CONVERSATION SAYS WHY, an abort read ahead of a throw: an aborted provider may throw
 * as it unwinds, and the abort is what ended it.
 */
async function* traced(
    events: AsyncGenerator<AssistantEvent>,
    messageCount: number,
    signal: AbortSignal,
): AsyncGenerator<AssistantEvent> {
    const started = performance.now()
    let calls = 0
    let done: Extract<AssistantEvent, { type: 'done' }> | undefined
    let failure: string | undefined
    try {
        for await (const event of events) {
            if (event.type === 'tool') calls += 1
            else if (event.type === 'done') done = event
            yield event
        }
    } catch (thrown) {
        failure = thrown instanceof Error ? thrown.message : String(thrown)
        throw thrown
    } finally {
        const ending =
            done?.stop ??
            (signal.aborted
                ? 'unfinished aborted'
                : failure === undefined
                  ? 'unfinished stopped'
                  : 'unfinished failed')
        ASSISTANT_LOG.debug(
            ending,
            `${messageCount} messages`,
            `${calls} tool calls`,
            done === undefined
                ? 'no usage'
                : `${done.usage.input}/${done.usage.output} tokens`,
            `${(performance.now() - started).toFixed(1)}ms`,
            ...(ending === 'unfinished failed' ? [failure] : []),
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
