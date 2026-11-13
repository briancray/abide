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
import { declare } from '#shared/rpc.ts'

import { blocksOf, forwardOf, type Provider } from './assistant.ts'
import {
    fromNativeWindow,
    mintCode,
    pairingNow,
    pairingStatus,
    permit as permitPrompt,
    runTurn,
    watchFollowedPairing,
} from './bridgeRelay.ts'
import { callerOf } from './callerOf.ts'
import { config, ownOrigin, settingOn } from './config.ts'
import { mcpFailure } from './generatedSurfaces.ts'
import { HOOKS, inOrder } from './hooks.ts'
import { followedOwn, mountedOwn } from './mountHandlers.ts'
import { signedInAs } from './principal.ts'
import { request } from './requestScope.ts'

/**
 * The Claude Code options a site may set for a turn, and the tools of the visitor's machine it asks
 * for: built-in by name, or of the visitor's own MCP servers as `mcp__<server>__<tool>`.
 */
export type ClaudeCodeConfig = {
    model?: string
    fallbackModel?: string
    systemPrompt?: string
    appendSystemPrompt?: string
    effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
    maxBudgetUsd?: number
    betas?: string[]
    disallowedTools?: string[]
    tools?: string[]
}

/**
 * The tools a pairing command grants, as the visitor would after its `--` (44.32), whether it asks for
 * everything the visitor's Claude Code has, as their `--full` (44.85), and the app's note on why, which
 * the question a link asks shows as its own words (44.91).
 */
type PairingOptions = Pick<ClaudeCodeConfig, 'tools'> & {
    full?: boolean
    note?: string
}

/** The visitor's own Claude Code, reached through the bridge paired to their browser. */
function claudeCodeProvider(config: ClaudeCodeConfig = {}): Provider {
    return {
        async *run(messages, tools, { maxTurns, signal }) {
            yield* runTurn({
                caller: askingCaller(),
                signedIn: signedInAs(),
                local: fromNativeWindow(),
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
 * The transcript as the one message Claude Code is sent, as Messages API blocks: earlier turns folded
 * above the last, and each image in its place. 44.5.
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
            pieces.push({ type: 'text', text: words }, piece)
            words = ''
        }
        if (index < last) words += `\n</${message.role}>\n`
        if (index === last - 1) words += '</conversation>\n\n'
    }
    pieces.push({ type: 'text', text: words })
    return blocksOf(pieces)
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
 * The command and the link that pair a bridge with this browser, and when their code stops standing.
 * 44.14. The `tools` it is given are written after the command's `--` and in the link, so the visitor
 * running either grants them (44.29, 44.32, 44.40), `full` is the command's `--full` and the link's
 * ask for it (44.85), and `note` is kept with the code, for the question its link asks (44.91).
 */
function bridgeCommand(options: PairingOptions = {}): {
    command: string
    link: string
    install: string
    expires: number
} {
    const { code, expires } = mintCode(
        askingCaller(),
        signedInAs(),
        options.tools,
        options.note,
    )
    return { ...commandFor(code, options), expires }
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

/** Every `onPairing`'s arguments, in 37.7's order, asked in the request's scope. 44.76. */
function pairingArgs(): string[] {
    const args: string[] = []
    for (const answer of inOrder(HOOKS.pairing)) args.push(...answer())
    return args
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
        caller: askingCaller(),
        signedIn: signedInAs(),
        local: fromNativeWindow(),
        id,
        allow,
    })
}

/** The visitor's own Claude Code as a provider, with the pairing that reaches it. */
export const claudeCode: typeof claudeCodeProvider & {
    bridge: typeof bridge
    bridgeCommand: typeof bridgeCommand
    permit: typeof permit
} = Object.assign(claudeCodeProvider, { bridge, bridgeCommand, permit })

// 44.67 — THE PAIRING A BROWSER'S `pairing` READS, as a handler abide mounts rather than one each app
// writes: the asking browser's pairing as it stands, granting the tools `ABIDE_BRIDGE_TOOLS` names,
// asking for full access where `ABIDE_BRIDGE_FULL` is on (44.85), and with `ABIDE_BRIDGE_NOTE` (44.91).
// 44.74 — THE SERVER DECIDES THEM: the parameter is declared only so the value is keyed and the call
// runs it (1.7, as `health`'s is), and whatever a request names in it is never read. 44.68 — on no
// generated surface.
//
// 44.75, 18.36 — NOT A STREAM: a page follows it over the mux it already holds, and is sent a refresh
// whenever the pairing changes or its code expires, so no http connection is held while it watches.
const pairingHandler = declare('GET')(
    (_none: undefined): BridgeStatus => {
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
        return {
            paired,
            missing,
            ...commandFor(code, {
                ...(tools.length === 0 ? {} : { tools }),
                full: settingOn('ABIDE_BRIDGE_FULL'),
            }),
        }
    },
    { clients: { ui: false, mcp: false, cli: false, openapi: false } },
)

/** The handler `/__abide/pairing` is answered by, followed over the mux. */
export const PAIRING_MOUNT = followedOwn(
    mountedOwn(PAIRING_ADDRESS, 'pairing', pairingHandler),
    watchFollowedPairing,
)
