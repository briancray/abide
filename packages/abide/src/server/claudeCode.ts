// 44.13 — THE CLAUDE CODE ON THE VISITOR'S OWN MACHINE AS A `Provider`, reached through the bridge they
// paired (`bridgeRelay.ts`). Claude Code runs its own loop there; what this side does is hand it the
// turn and answer the MCP requests it makes from the `Toolbox` — in this request's scope, as this
// asker (44.7) — so its tools are the site's and nothing of the visitor's machine is one.
//
// CONFIGURED BY CLAUDE CODE'S OWN OPTION NAMES, which the bridge lays on as their flags, and only the ones
// that shape the answer. What would give a site power over the visitor's machine — permissions,
// directory, settings, an MCP server — is not an option here at all, and its `tools`, built-in or of
// the visitor's own MCP servers, are a request the visitor grants or does not: the bridge decides
// (44.15, 44.16, 44.29).

import type {
    AssistantContent,
    AssistantMessage,
} from '#shared/AssistantEvent.ts'
import { BRIDGE_SCHEME } from '#shared/BRIDGE_SCHEME.ts'
import { mounted } from '#shared/mount.ts'
import { refuse } from '#shared/refuse.ts'

import { blocksOf, forwardOf, type Provider } from './assistant.ts'
import { BRIDGE_VERSION } from './BRIDGE_VERSION.ts'
import { mintCode, pairingStatus, runTurn } from './bridgeRelay.ts'
import { callerOf } from './callerOf.ts'
import { ownOrigin } from './config.ts'
import { mcpFailure } from './generatedSurfaces.ts'
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

/** The tools a pairing command grants, as the visitor would after its `--`. 44.32. */
type PairingOptions = Pick<ClaudeCodeConfig, 'tools'>

/**
 * Whether this browser's bridge is connected, the tools it asked for that the bridge cannot give, and
 * the command and the link that pair one — in place of the one connected, where one is — with the
 * command that installs what opens the link.
 */
export type BridgeStatus = {
    paired: boolean
    missing: string[]
    command: string
    link: string
    install: string
}

/** The visitor's own Claude Code, reached through the bridge paired to their browser. */
function claudeCodeProvider(config: ClaudeCodeConfig = {}): Provider {
    return {
        async *run(messages, tools, { maxTurns, signal }) {
            yield* runTurn({
                caller: askingCaller(),
                signedIn: signedInAs(),
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
 * running either grants them (44.29, 44.32, 44.40).
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
    )
    return { ...commandFor(code, options), expires }
}

/**
 * The command and the link that pair a bridge by `code`, granting `tools`, and the command that
 * installs the app the link opens — of the release the command runs, 44.56.
 */
function commandFor(
    code: string,
    { tools }: PairingOptions,
): { command: string; link: string; install: string } {
    const site = `${ownOrigin(request().url)}${mounted('')}`
    const granted = tools?.length ? tools.join(',') : undefined
    const query = new URLSearchParams({ site, code, version: BRIDGE_VERSION })
    if (granted !== undefined) query.set('tools', granted)
    const grant = granted === undefined ? '' : ` -- --tools ${granted}`
    return {
        command: `bunx @abide/bridge@${BRIDGE_VERSION} ${site} ${code}${grant}`,
        link: `${BRIDGE_SCHEME}://pair?${query}`,
        install: `bunx @abide/bridge@${BRIDGE_VERSION} install`,
    }
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
        request().signal,
    ))
        yield { paired, missing, ...commandFor(code, options) }
}

/** The visitor's own Claude Code as a provider, with the pairing that reaches it. */
export const claudeCode: typeof claudeCodeProvider & {
    bridge: typeof bridge
    bridgeCommand: typeof bridgeCommand
} = Object.assign(claudeCodeProvider, { bridge, bridgeCommand })
