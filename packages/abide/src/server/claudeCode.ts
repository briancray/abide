// 44.13 — THE CLAUDE CODE ON THE VISITOR'S OWN MACHINE AS A `Provider`, reached through the bridge they
// paired (`bridgeRelay.ts`), or in the native app's window, through its own (44.77). Claude Code runs its own loop there; what this side does is hand it the
// turn and answer the MCP requests it makes from the `Toolbox` — in this request's scope, as this
// asker (44.7) — so its tools are the site's and nothing of the visitor's machine is one.
//
// CONFIGURED BY CLAUDE CODE'S OWN OPTION NAMES, which the bridge lays on as their flags, and only the ones
// that shape the answer. What would give a site power over the visitor's machine — permissions,
// directory, settings, an MCP server — is not an option here at all, and its `tools`, built-in or of
// the visitor's own MCP servers, are a request the visitor grants or does not: the bridge decides
// (44.15, 44.16, 44.29, 44.82). What auto mode would ask the visitor is a `permission` event, which the
// page answers through `permit` (44.81, 44.83).
//
// 44.93 — ONE TOOL OF THE VISITOR'S MACHINE CAN BE CALLED WITH NO MODEL, through `callTool`: the bridge
// speaks MCP to the server itself, under the grant a turn naming that tool alone would have, and
// asks nothing past it (44.94). Where the bridge cannot make it, a turn does (44.99).

export type { BridgeStatus } from '#shared/BridgeStatus.ts'

// The bridge a pairing command names is the one installed beside this abide: the release whose
// relay this server speaks, and the one a native app runs in process.
import bridgePackage from '@abide/bridge/package.json' with { type: 'json' }

import { PAIRING_ADDRESS } from '#shared/ADDRESSES.ts'
import type {
    AssistantContent,
    AssistantMessage,
} from '#shared/AssistantEvent.ts'
import { BRIDGE_SCHEME } from '#shared/BRIDGE_SCHEME.ts'
import type { BridgeStatus } from '#shared/BridgeStatus.ts'
import { mounted } from '#shared/mount.ts'
import { refuse } from '#shared/refuse.ts'
import { rpc } from '#shared/rpc.ts'

import {
    blocksOf,
    forwardOf,
    type Provider,
    type ProviderEvent,
    type ToolAnswer,
} from './assistant.ts'
import {
    type Asker,
    fromNativeWindow,
    pairingArgs,
    pairingNow,
    pairingStatus,
    permit as permitPrompt,
    runCall,
    runTurn,
    watchFollowedPairing,
} from './bridgeRelay.ts'
import { callerOf } from './callerOf.ts'
import { config, ownOrigin, settingOn } from './config.ts'
import { mcpFailure } from './generatedSurfaces.ts'
import { followedOwn, mountedOwn } from './mountHandlers.ts'
import { signedInAs } from './principal.ts'
import { request } from './requestScope.ts'

/**
 * The Claude Code options a site may set for a turn, and the tools of the visitor's machine it asks
 * for: built-in by name, or of the visitor's own MCP servers as `mcp__<server>__<tool>`.
 */
export type ClaudeCodeConfig = {
    model?: string | undefined
    fallbackModel?: string | undefined
    systemPrompt?: string | undefined
    appendSystemPrompt?: string | undefined
    effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | undefined
    maxBudgetUsd?: number | undefined
    betas?: string[] | undefined
    disallowedTools?: string[] | undefined
    tools?: string[] | undefined
}

/**
 * The tools a pairing command grants, as the visitor would after its `--` (44.32), whether it asks for
 * everything the visitor's Claude Code has, as their `--full` (44.85), and the app's note on why, which
 * the question a link asks shows as its own words (44.91).
 */
type PairingOptions = Pick<ClaudeCodeConfig, 'tools'> & {
    full?: boolean | undefined
    note?: string | undefined
}

/** The visitor's own Claude Code, reached through the bridge paired to their browser. */
function claudeCodeProvider(config: ClaudeCodeConfig = {}): Provider {
    return {
        async *run(messages, tools, { maxTurns, signal }) {
            // 44.103 — refused before the bridge is asked, rather than answered by Claude Code's 400.
            for (const message of messages)
                for (const piece of message.content)
                    if (!cachedAnHour(piece))
                        throw refuse(
                            400,
                            `A ${piece.type} in the transcript is cached for five minutes, and Claude Code caches for an hour after it — name ttl: '1h'. RULEBOOK 44.103.`,
                        )
            yield* runTurn({
                ...asker(),
                prompt: foldedContent(messages),
                config,
                maxTurns,
                // 44.17 — answered by the app's own MCP surface, through the turn's `Toolbox`.
                answer: (method, params) =>
                    forwardOf(tools)(method, params).catch((thrown: unknown) =>
                        mcpFailure(-32603, String(thrown)),
                    ),
                signal,
            })
        },
    }
}

/**
 * Whether `piece`, and every block inside it, is cached for an hour where it is cached at all. 44.103.
 *
 * Claude Code puts breakpoints of an hour of its own after the transcript, and the API refuses a
 * five-minute breakpoint ahead of an hour's.
 */
function cachedAnHour(piece: AssistantContent): boolean {
    if (
        'cache_control' in piece &&
        piece.cache_control !== undefined &&
        piece.cache_control.ttl !== '1h'
    )
        return false
    const inner =
        piece.type === 'search_result'
            ? piece.content
            : piece.type === 'tool_result' && Array.isArray(piece.content)
              ? piece.content
              : piece.type === 'document' &&
                  piece.source.type === 'content' &&
                  typeof piece.source.content !== 'string'
                ? piece.source.content
                : []
    for (const block of inner) if (!cachedAnHour(block)) return false
    return true
}

/**
 * The transcript as the one message Claude Code is sent, as Messages API blocks: earlier turns folded
 * above the last, each image in its place, and each tool call and what it answered written out in
 * words, since a call this Claude Code did not make is none it can be handed as one. 44.5.
 */
function foldedContent(
    messages: (AssistantMessage & { content: AssistantContent[] })[],
): unknown[] {
    const pieces: AssistantContent[] = []
    let words = messages.length > 1 ? '<conversation>\n' : ''
    const last = messages.length - 1
    for (let index = 0; index <= last; index++) {
        const message = messages[index] as (typeof messages)[number]
        if (index < last) words += `<${message.role}>\n`
        for (let at = 0; at < message.content.length; at++) {
            const piece = message.content[at] as AssistantContent
            if (at > 0) words += '\n'
            if (piece.type === 'text') {
                words += piece.text
                continue
            }
            if (piece.type === 'tool_use') {
                words += `<tool_use name="${piece.name}">${JSON.stringify(piece.input)}</tool_use>`
                continue
            }
            if (piece.type === 'tool_result') {
                words += `<tool_result${piece.is_error === true ? ' error' : ''}>`
                const answered =
                    typeof piece.content === 'string'
                        ? [{ type: 'text' as const, text: piece.content }]
                        : (piece.content ?? [])
                for (const block of answered)
                    if (block.type === 'text') words += block.text
                    else {
                        pieces.push({ type: 'text', text: words }, block)
                        words = ''
                    }
                words += '</tool_result>'
                continue
            }
            // Reasoning another run wrote is that run's, and none a prompt carries.
            if (piece.type === 'thinking' || piece.type === 'redacted_thinking')
                continue
            pieces.push({ type: 'text', text: words }, piece)
            words = ''
        }
        if (index < last) words += `\n</${message.role}>\n`
        if (index === last - 1) words += '</conversation>\n\n'
    }
    pieces.push({ type: 'text', text: words })
    return blocksOf(pieces)
}

/** Who asks of a pairing, as the request in scope says. */
function asker(): Asker {
    return {
        caller: askingCaller(),
        signedIn: signedInAs(),
        local: fromNativeWindow(),
    }
}

/** The browser asking, which a pairing is to. 44.13. */
function askingCaller(): string {
    const caller = callerOf()
    if (caller === undefined)
        throw refuse(
            400,
            'A Claude Code bridge pairs with a browser, and this request carries none: it has to come from a page.',
        )
    return caller
}

/**
 * The command and the link that pair a bridge by `code`, granting `tools` and asking for `full`, and
 * the command that installs the app the link opens — of the release the command runs, 44.56.
 */
function commandFor(
    code: string,
    { tools, full }: PairingOptions,
): { command: string; link: string; install: string } {
    const site = `${ownOrigin(request().url)}${mounted('')}`
    const granted = tools?.length ? tools.join(',') : undefined
    const query = new URLSearchParams({
        site,
        code,
        version: bridgePackage.version,
    })
    if (granted !== undefined) query.set('tools', granted)
    if (full === true) query.set('full', '1')
    // 44.76 — the site's own arguments after the tools, in the command and the install alike; the
    // link carries none (44.44), so an install is how a link opened later runs with them.
    const added = pairingArgs()
    const options =
        granted === undefined ? added : ['--tools', granted, ...added]
    return {
        command: `bunx @abide/bridge@${bridgePackage.version} ${site} ${code}${full === true ? ' --full' : ''}${afterDashes(options)}`,
        link: `${BRIDGE_SCHEME}://pair?${query}`,
        install: `bunx @abide/bridge@${bridgePackage.version} install${afterDashes(added)}`,
    }
}

/** ` -- ` and `words`, each quoted where a shell would split or expand it, or nothing for none. */
function afterDashes(words: readonly string[]): string {
    if (words.length === 0) return ''
    let line = ' --'
    for (const word of words)
        line += /^[\w@%+=:,./-]+$/.test(word)
            ? ` ${word}`
            : ` '${word.replaceAll("'", "'\\''")}'`
    return line
}

/**
 * This browser's pairing as it changes: unpaired, then paired the moment a bridge connects, and
 * unpaired again if it goes — following whoever signs in at the browser since — each status with the
 * command to run and the link to open. 44.20, 44.34, 44.59, 44.60.
 */
async function* bridge(
    options: PairingOptions = {},
): AsyncGenerator<BridgeStatus> {
    for await (const { paired, code, missing } of pairingStatus(
        askingCaller(),
        signedInAs(),
        options.tools ?? [],
        options.note,
        request().signal,
        fromNativeWindow(),
    ))
        yield { paired, missing, ...commandFor(code, options) }
}

/**
 * Answers the `permission` event `id` a turn of this browser's bridge is waiting on, allowing the call
 * or not. 44.83.
 *
 * Throws 404 where no prompt of that id is waiting.
 */
function permit(id: string, allow: boolean): void {
    permitPrompt({
        ...asker(),
        id,
        allow,
    })
}

/**
 * What the MCP tool `tool` of the visitor's machine, named `mcp__<server>__<tool>`, answered `input`,
 * called through this browser's bridge with no model (44.93), or by a turn where the bridge could not
 * make the call itself (44.99). Ended where the request is.
 *
 * Throws 409 where no bridge is paired, 403 where the visitor did not give the site the tool to call
 * (44.94), and 502 where neither the bridge nor a turn made the call.
 */
async function callTool(tool: string, input: unknown): Promise<ToolAnswer> {
    const asking = asker()
    const called = await runCall({
        ...asking,
        name: tool,
        input,
        signal: request().signal,
    })
    return called ?? calledByTurn(asking, tool, input)
}

/**
 * 44.99 — THE CALL THE BRIDGE COULD NOT MAKE, made by the cheapest turn that makes it: the one tool
 * granted, the model told the input, a prompt for that call allowed as the call itself would be
 * (44.94), and the run ended the moment the tool answers — so what is returned is the tool's answer,
 * never the model's copy of it, and no tokens are spent past the call.
 */
async function calledByTurn(
    asking: Asker,
    tool: string,
    input: unknown,
): Promise<ToolAnswer> {
    const ending = new AbortController()
    const signal = AbortSignal.any([request().signal, ending.signal])
    let callId: string | undefined
    for await (const event of runTurn({
        ...asking,
        prompt: [
            {
                type: 'text',
                text: `Call the tool ${tool} once, with exactly this input, and do nothing else.\n\n${JSON.stringify(input ?? {})}`,
            },
        ],
        config: { model: 'haiku', effort: 'low', tools: [tool] },
        maxTurns: 2,
        answer: () => Promise.resolve(mcpFailure(-32601, 'no tools')),
        signal,
    })) {
        if (
            event.type === 'content_block_start' &&
            event.content_block.type === 'tool_use' &&
            event.content_block.name === tool &&
            callId === undefined
        )
            callId = event.content_block.id
        else if (event.type === 'permission')
            permitPrompt({
                ...asking,
                id: event.id,
                allow: event.name === tool,
            })
        else if (event.type === 'tool_result' && event.tool_use_id === callId) {
            // 44.18 — ended while the turn still listens, so the bridge stops the run before the
            // model writes a word about the answer.
            ending.abort()
            return {
                content: mcpContentOf(event.content),
                isError: event.is_error,
            }
        }
    }
    throw refuse(
        502,
        `The call failed: the bridge could not reach ${tool}, and Claude Code did not call it.`,
    )
}

/** A tool result's blocks as the MCP content a `ToolAnswer` holds: words, and an image as its bytes. */
function mcpContentOf(
    content: Extract<ProviderEvent, { type: 'tool_result' }>['content'],
): ToolAnswer['content'] {
    const pieces: ToolAnswer['content'] = []
    for (const block of content)
        if (block.type === 'text')
            pieces.push({ type: 'text', text: block.text })
        else if (block.source.type === 'base64')
            pieces.push({
                type: 'image',
                data: block.source.data,
                mimeType: block.source.media_type,
            })
    return pieces
}

/** The visitor's own Claude Code as a provider, with the pairing that reaches it. */
export const claudeCode: typeof claudeCodeProvider & {
    bridge: typeof bridge
    callTool: typeof callTool
    permit: typeof permit
} = Object.assign(claudeCodeProvider, {
    bridge,
    callTool,
    permit,
})

// 44.67 — THE PAIRING A BROWSER'S `pairing` READS, as a handler abide mounts rather than one each app
// writes: the asking browser's pairing as it stands, granting the tools `ABIDE_BRIDGE_TOOLS` names,
// asking for full access where `ABIDE_BRIDGE_FULL` is on (44.85), and with `ABIDE_BRIDGE_NOTE` (44.91).
// 44.74 — THE SERVER DECIDES THEM: the parameter is declared only so the value is keyed and the call
// runs it (1.7, as `health`'s is), and whatever a request names in it is never read. 44.68 — on no
// generated surface.
//
// 44.75, 18.36 — NOT A STREAM: a page follows it over the mux it already holds, and is sent a refresh
// whenever the pairing changes or its code expires, so no http connection is held while it watches.
const pairingHandler = rpc(
    (): BridgeStatus | Promise<BridgeStatus> => {
        const configured = config.peek()?.ABIDE_BRIDGE_TOOLS
        const tools =
            typeof configured === 'string' && configured !== ''
                ? configured.split(',')
                : []
        const noted = config.peek()?.ABIDE_BRIDGE_NOTE
        const { paired, code, missing } = pairingNow(
            askingCaller(),
            signedInAs(),
            tools,
            typeof noted === 'string' && noted !== '' ? noted : undefined,
            fromNativeWindow(),
        )
        const command = commandFor(code, {
            ...(tools.length === 0 ? {} : { tools }),
            full: settingOn('ABIDE_BRIDGE_FULL'),
        })
        const status = (found: string[]): BridgeStatus => ({
            paired,
            missing: found,
            ...command,
        })
        return Array.isArray(missing) ? status(missing) : missing.then(status)
    },
    { clients: { ui: false, mcp: false, cli: false, openapi: false } },
)

/** The handler `/__abide/pairing` is answered by, followed over the mux. */
export const PAIRING_MOUNT = followedOwn(
    mountedOwn(PAIRING_ADDRESS, 'pairing', pairingHandler),
    watchFollowedPairing,
)
