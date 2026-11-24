// SECTION 44 — A CONVERSATION WITH A MODEL, piped through a handler the app wrote. `assistant` is what
// every provider shares: the transcript's check, the app's MCP tools as a `Toolbox`, and the turn cap.
// A `Provider` runs the conversation — `provider.claudeApi` by looping over the Messages API itself,
// `provider.claudeCode` by handing it to a Claude Code on the visitor's own machine — and yields the one
// `AssistantEvent` stream either way (44.2).
//
// THE TOOLS ARE THE APP'S OWN MCP SURFACE (44.6), called in process through the app answering this
// request and carrying the asker's credentials (44.7), so a tool does what the person asking could do
// and nothing more. Both are CAPTURED when the conversation starts: a provider may call a tool from
// another request's scope — `provider.claudeCode` answers one from the bridge's — and the call is still this
// asker's.
//
// 44.100 — OUTSIDE A REQUEST, IN THE NATIVE APP, THE ASKER IS THE WINDOW: a timer's or `onStart`'s
// conversation runs in a scope over the window's latest request as 44.7 carries it, so the principal,
// the caller and the window's credential all read as they did there, and `provider.claudeCode` finds
// the app's own bridge (44.77) by the same check a request from the window passes.
//
// 44.101 — OUTSIDE A REQUEST ANYWHERE ELSE, NO ONE ASKS: a `global` value's run among them, which
// runs in whichever request reached it first and is still no request's. The app's life is its signal,
// and it has no tools, there being no one for them to act as.

import type {
    AssistantContent,
    AssistantEvent,
    AssistantMessage,
} from '#shared/AssistantEvent.ts'
import { IMAGE_TYPES } from '#shared/IMAGE_TYPES.ts'
import { namedLogger } from '#shared/log.ts'
import { messageOf } from '#shared/messageOf.ts'
import { parsedJson } from '#shared/parsedJson.ts'
import { randomToken } from '#shared/randomToken.ts'
import { abortSignal } from '#shared/reactive/poll.ts'
import { refuse } from '#shared/refuse.ts'
import { wordsOf } from '#shared/wordsOf.ts'

import {
    carriesWindowCredential,
    NATIVE_COOKIE,
    windowCredential,
} from './bridgeRelay.ts'
import { CALLER_COOKIE } from './callerOf.ts'
import { mcpFailure, type McpReply, McpSurface } from './generatedSurfaces.ts'
import {
    type AnsweringApp,
    currentRequestScope,
    inGlobalRun,
    inOpenScope,
    releaseScope,
    scopeFor,
    within,
} from './requestScope.ts'

/**
 * An `AssistantEvent` as a `Provider` yields it: a tool call's result with the value `assistant` reads
 * off the app's own surface still to come.
 */
export type ProviderEvent =
    | Exclude<AssistantEvent, { type: 'tool_result' }>
    | Omit<Extract<AssistantEvent, { type: 'tool_result' }>, 'value'>

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

/** What a tool call answered, as MCP's result has it: its content, and whether it failed. 20.21, 44.35. */
export type ToolAnswer = {
    content: (
        | { type: 'text'; text: string }
        | { type: 'image'; data: string; mimeType: string }
    )[]
    isError: boolean
}

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
export type AssistantOptions = {
    tools?: boolean
    maxTurns?: number
    signal?: AbortSignal
}

const MAX_TURNS = 10
const ASSISTANT_LOG = namedLogger('abide:assistant')
// 44.7 — the caller's credentials, and nothing else of their request.
const CARRIED_HEADERS = ['cookie', 'authorization']

// 44.100 — the native app's window as its latest request left it: that request as a tool call carries
// it, and the app it reached — or, before it has made one, the app booted last.
const WINDOW: {
    asker: Request | undefined
    app: AnsweringApp | undefined
    // The caller a conversation before the window's first request is, minted once: a bridge pairs
    // with a browser (44.13), and the window has not been handed one yet.
    caller: string | undefined
} = {
    asker: undefined,
    app: undefined,
    caller: undefined,
}

/** Keeps `given` as the window's latest request, where it carries the window's credential. 44.100. */
export function noteWindow(given: Request, app: AnsweringApp): void {
    if (!carriesWindowCredential(given)) return
    WINDOW.asker = askerOf(given)
    WINDOW.app = app
}

/** 44.100 — the app a conversation runs through before the window has made a request of it. */
export function noteBooted(app: AnsweringApp): void {
    if (WINDOW.asker === undefined) WINDOW.app = app
}

/**
 * The window's latest request, or — 44.100, before it has made one — a request carrying the window's
 * credential, which the process minted and so holds before the window does, and a caller of its own.
 * `undefined` outside the native app.
 */
function windowAsker(): Request | undefined {
    if (WINDOW.asker !== undefined) return WINDOW.asker
    const credential = windowCredential()
    if (credential === undefined || WINDOW.app === undefined) return undefined
    WINDOW.caller ??= randomToken(16, 'hex')
    return new Request('http://localhost/', {
        headers: {
            cookie: `${NATIVE_COOKIE}=${credential}; ${CALLER_COOKIE}=${WINDOW.caller}`,
        },
    })
}

/** A conversation over `messages`, run by `provider`, as the events it produces. */
export async function* assistant(
    messages: AssistantMessage[],
    provider: Provider,
    options: AssistantOptions = {},
): AsyncGenerator<AssistantEvent> {
    // 44.57 — A `global` VALUE'S RUN IS NO REQUEST'S, whichever request reached it first: the reader
    // leaving is not the end of an answer every other reader is reading.
    const asking = inGlobalRun() ? undefined : currentRequestScope()?.request
    const window = asking === undefined ? windowAsker() : undefined
    if (window !== undefined) {
        yield* asWindow(window, messages, provider, options)
        return
    }
    // 44.101 — NO ONE ASKED: a `global` value's run, a timer's, `onStart`'s. There is no one for a
    // tool to act as, and a `global` value's answer is every caller's.
    if (asking === undefined && options.tools === true)
        throw new Error(
            'abide: assistant was asked for tools outside a request, and there is no asker for them to act as — no request is being answered, and outside the native app there is no window to ask as. RULEBOOK 44.101.',
        )
    yield* converse(messages, provider, options, asking)
}

/** The conversation `assistant` decided `asking` asks — `undefined` for no one. */
async function* converse(
    messages: AssistantMessage[],
    provider: Provider,
    options: AssistantOptions,
    asking: Request | undefined,
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
            if (
                piece?.type !== 'image' &&
                piece?.type !== 'document' &&
                piece?.type !== 'search_result'
            )
                continue
            // 44.37 — an attachment is the asker's to show, never a turn the model answered.
            if (message.role !== 'user')
                throw refuse(
                    400,
                    `A ${piece.type} can only stand in a user turn of the transcript. RULEBOOK 44.37.`,
                )
            // 44.36.
            if (piece.type === 'search_result') continue
            const refused = refusalOf(piece)
            if (refused !== undefined) throw refuse(400, refused)
        }
    }
    const surface = options.tools === true ? appSurface() : NO_SURFACE
    const tools = toolboxOver(
        surface,
        asking === undefined ? NO_ASKER : askerOf(asking),
    )
    // 44.57 — the caller's signal and the request's are one: either ends the conversation. Where no
    // request owns the run, the app's own life is the one it has, as a `global` value's `poll` (7.26).
    const owner = asking === undefined ? abortSignal() : asking.signal
    const signal =
        options.signal === undefined
            ? owner
            : AbortSignal.any([owner, options.signal])
    const events = endedBy(
        provider.run(turns, tools, {
            maxTurns: options.maxTurns ?? MAX_TURNS,
            signal,
        }),
        signal,
    )
    // 28.7 — a closed namespace pays for no line.
    yield* ASSISTANT_LOG.enabled()
        ? traced(read(events, surface), messages.length, signal)
        : read(events, surface)
}

/**
 * `events` until `signal` aborts, then `aborted`. 44.57.
 *
 * THE ABORT DOES NOT WAIT FOR THE PROVIDER: one stuck in an await it was handed no signal for — a
 * bridge that never answers — is asked to return and left to, and the conversation ends now. An
 * abort read ahead of a throw, as `traced` reads it: a provider that throws as it unwinds was ended
 * by the abort.
 */
async function* endedBy(
    events: AsyncGenerator<ProviderEvent>,
    signal: AbortSignal,
): AsyncGenerator<ProviderEvent> {
    // A STEP RACES ITS OWN ABORT: one promise pending for the whole conversation would keep a
    // reaction per event, none freed until it ends.
    let rejectStep: (reason: unknown) => void = () => {}
    const stop = (): void => rejectStep(refuse.aborted())
    signal.addEventListener('abort', stop, { once: true })
    try {
        for (;;) {
            if (signal.aborted) throw refuse.aborted()
            const step = await Promise.race([
                events.next(),
                new Promise<never>((_, reject) => {
                    rejectStep = reject
                }),
            ])
            if (step.done === true) return
            yield step.value
        }
    } catch (thrown) {
        throw signal.aborted ? refuse.aborted() : thrown
    } finally {
        signal.removeEventListener('abort', stop)
        // A provider still awaiting returns once that await settles, and nobody waits for it.
        events.return(undefined).catch(() => {})
    }
}

/**
 * `events` with each answer's value read off `surface`: a call to a handler of the app that answers
 * a value, read as JSON (19.21). 44.49.
 *
 * READ HERE RATHER THAN BY EACH PROVIDER, so a provider the app wrote yields the same events abide's
 * do (44.2): a provider names the tool as the `Toolbox` lists it (44.50), and the rest is the surface's.
 * The handler a call reached is its tool's name, which a page resolves itself (44.48, 44.51).
 */
async function* read(
    events: AsyncGenerator<ProviderEvent>,
    surface: McpSurface,
): AsyncGenerator<AssistantEvent> {
    // Whether each call, by id, reached a handler answering a value.
    const valued = new Map<string, boolean>()
    for await (const event of events) {
        if (
            event.type === 'content_block_start' &&
            event.content_block.type === 'tool_use'
        ) {
            const tool = surface.tool(event.content_block.name)
            valued.set(
                event.content_block.id,
                tool !== undefined && tool.result !== undefined,
            )
            yield event
        } else if (event.type === 'tool_result')
            yield {
                ...event,
                value:
                    valued.get(event.tool_use_id) === true && !event.is_error
                        ? parsedJson(wordsOf(event.content))
                        : undefined,
            }
        else yield event
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
    // Each run's usage is its `message_start`'s, overwritten by its `message_delta`'s.
    let run: Record<string, unknown> = {}
    let input = 0
    let output = 0
    let stop: string | null = null
    let ended = false
    let failure: string | undefined
    try {
        for await (const event of events) {
            if (
                event.type === 'content_block_start' &&
                event.content_block.type === 'tool_use'
            )
                calls += 1
            else if (event.type === 'message_start')
                run = { ...event.message.usage }
            else if (event.type === 'message_delta') {
                Object.assign(run, event.usage)
                stop = event.delta.stop_reason
            } else if (event.type === 'message_stop') {
                input += Number(run.input_tokens ?? 0)
                output += Number(run.output_tokens ?? 0)
            }
            yield event
        }
        ended = true
    } catch (thrown) {
        failure = messageOf(thrown)
        throw thrown
    } finally {
        const ending =
            ended && stop !== null
                ? stop
                : signal.aborted
                  ? 'unfinished aborted'
                  : failure === undefined
                    ? 'unfinished stopped'
                    : 'unfinished failed'
        ASSISTANT_LOG.debug(
            ending,
            `${messageCount} messages`,
            `${calls} tool calls`,
            `${input}/${output} tokens`,
            `${(performance.now() - started).toFixed(1)}ms`,
            ...(ending === 'unfinished failed' ? [failure] : []),
        )
    }
}

/** Where an MCP request is answered, as JSON-RPC's `result` or `error`. */
type McpForward = (method: string, params: unknown) => Promise<McpReply>

// WHAT A `Toolbox` FORWARDS AN MCP REQUEST TO, for a provider that speaks MCP itself (`provider.claudeCode`):
// the app's own surface, verbatim, rather than a second server rebuilt over `list` and `call`. Beside
// the type rather than on it, since a `Toolbox` is public and this is not.
const FORWARDS = new WeakMap<Toolbox, McpForward>()

/**
 * Where `tools` sends an MCP request whole. 44.17.
 *
 * A `Toolbox` a provider narrowed or built is answered from its OWN `list` and `call` — a provider
 * handing another the tools it chose is the turn's toolbox too — and the protocol around them is the
 * app's, which no tool changes.
 */
export function forwardOf(tools: Toolbox): McpForward {
    const built = FORWARDS.get(tools)
    if (built !== undefined) return built
    return async (method, params) => {
        if (method === 'tools/list') return { result: { tools: tools.list } }
        if (method !== 'tools/call')
            return NO_SURFACE.answer(method, undefined, NO_ASKER)
        const { name, arguments: input } = (params ?? {}) as {
            name?: unknown
            arguments?: unknown
        }
        let listed = false
        for (const tool of tools.list) if (tool.name === name) listed = true
        if (!listed) return mcpFailure(-32602, `No tool named ${String(name)}.`)
        return { result: await tools.call(name as string, input ?? {}) }
    }
}

/**
 * `assistant` in a scope over the window's latest request, each step taken inside it. 44.100.
 *
 * Called only inside the native app.
 */
async function* asWindow(
    asker: Request,
    messages: AssistantMessage[],
    provider: Provider,
    options: AssistantOptions,
): AsyncGenerator<AssistantEvent> {
    const app = WINDOW.app as AnsweringApp
    // 44.57 — the asker's own signal never aborts, so the app stopping ends the conversation, or the
    // caller's signal.
    const ended =
        options.signal === undefined
            ? abortSignal()
            : AbortSignal.any([abortSignal(), options.signal])
    const scope = scopeFor(asker, asker, app)
    const conversation = converse(
        messages,
        provider,
        { ...options, signal: ended },
        asker,
    )
    try {
        for (;;) {
            const step = await inOpenScope(scope, () => conversation.next())
            if (step.done === true) return
            yield step.value
        }
    } finally {
        await inOpenScope(scope, () => conversation.return(undefined))
        releaseScope(scope)
    }
}

// The protocol's own requests ask nothing of the asker, so what answers them is asked as nobody.
const NO_ASKER = new Request('http://abide.invalid/')

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
                            text: messageOf(thrown),
                        },
                    ],
                    isError: true,
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
 * 44.36 — why a transcript's image or document is none the Messages API takes, or `undefined`: one
 * with no source, an image carried inline of a type other than 44.36 names, a document carried inline
 * that is not a PDF or text that is not plain. A source abide does not carry the bytes of — a URL, an
 * uploaded file, content of its own — is the API's to judge.
 */
function refusalOf(
    piece: Extract<AssistantContent, { type: 'image' | 'document' }>,
): string | undefined {
    const source = piece.source as
        { type?: unknown; media_type?: unknown; data?: unknown } | undefined
    if (typeof source?.type !== 'string')
        return `An ${piece.type} in the transcript carries no source. RULEBOOK 44.36.`
    const inline = source.type === 'base64' || source.type === 'text'
    if (!inline) return undefined
    if (typeof source.data !== 'string')
        return `An ${piece.type} in the transcript carries no source data. RULEBOOK 44.36.`
    if (piece.type === 'image')
        return source.type === 'base64' &&
            IMAGE_TYPES.has(source.media_type as string)
            ? undefined
            : `An image in the transcript is ${String(source.media_type)}, and a model is shown only ${[...IMAGE_TYPES].join(', ')}. RULEBOOK 44.36.`
    return (source.type === 'base64' &&
        source.media_type === 'application/pdf') ||
        (source.type === 'text' && source.media_type === 'text/plain')
        ? undefined
        : `A document in the transcript is ${String(source.media_type)}, and one carried inline is read only as a base64 application/pdf or text/plain. RULEBOOK 44.36.`
}

/**
 * Pieces as the Messages API's blocks, which they already are, in order — save a text of whitespace
 * alone, which the API refuses. 44.38.
 */
export function blocksOf(content: AssistantContent[]): AssistantContent[] {
    const blocks: AssistantContent[] = []
    for (const piece of content)
        if (piece.type !== 'text' || /\S/.test(piece.text)) blocks.push(piece)
    return blocks
}

/**
 * A tool's answer as the Messages API's blocks for a `tool_result`: text as text, save whitespace
 * alone, and an MCP image as an image block. 44.35.
 */
export function toolBlocksOf(
    content: ToolAnswer['content'],
): Extract<AssistantEvent, { type: 'tool_result' }>['content'] {
    const blocks: Extract<AssistantEvent, { type: 'tool_result' }>['content'] =
        []
    for (const piece of content)
        if (piece.type === 'image')
            blocks.push({
                type: 'image',
                source: {
                    type: 'base64',
                    // 20.21 — an MCP image the app's surface answers is one a model is shown.
                    media_type: piece.mimeType as 'image/png',
                    data: piece.data,
                },
            })
        else if (/\S/.test(piece.text))
            blocks.push({ type: 'text', text: piece.text })
    return blocks
}
