// 45.13 — THE CLAUDE CODE ON THE VISITOR'S OWN MACHINE AS A `Provider`, reached through the bridge they
// paired (`bridgeRelay.ts`). Claude Code runs its own loop there; what this side does is hand it the
// turn and answer the MCP requests it makes from the `Toolbox` — in this request's scope, as this
// asker (45.7) — so its tools are the site's and nothing of the visitor's machine is one.
//
// CONFIGURED BY CLAUDE CODE'S OWN OPTION NAMES, and only the ones that shape the answer. What would give
// a site power over the visitor's machine — its own tools, permissions, directory, settings — is not an
// option here at all: the bridge decides it (45.15, 45.16).

import { mounted } from '#shared/mount.ts'
import { refuse } from '#shared/refuse.ts'
import {
    type AssistantEvent,
    type AssistantMessage,
    forwardOf,
    type Provider,
} from './assistant.ts'
import { BRIDGE_VERSION } from './BRIDGE_VERSION.ts'
import {
    mintCode,
    openTurn,
    pairedBridge,
    watchPairing,
} from './bridgeRelay.ts'
import { callerOf } from './callerOf.ts'
import { appOrigin } from './config.ts'
import { mcpFailure } from './generatedSurfaces.ts'
import { Inbox } from './Inbox.ts'
import { request } from './requestScope.ts'

/** The Claude Code options a site may set for a turn. */
export type ClaudeCodeConfig = {
    model?: string
    fallbackModel?: string
    systemPrompt?: string
    appendSystemPrompt?: string
    effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
}

/** Whether this browser's bridge is connected, and the command that pairs one where it is not. */
export type BridgeStatus = { paired: boolean; command: string | undefined }

/** The visitor's own Claude Code, reached through the bridge paired to their browser. */
function claudeCodeProvider(config: ClaudeCodeConfig = {}): Provider {
    return {
        async *run(messages, tools, { maxTurns, signal }) {
            const bridge = pairedBridge(askingCaller())
            // 45.13 — nothing paired is the page's cue to show the command.
            if (bridge === undefined)
                throw refuse(
                    409,
                    'No Claude Code is paired with this browser. claudeCode.bridgeCommand() is the command that pairs one.',
                )
            const turn = openTurn(bridge)
            bridge.frames.push({
                type: 'turn',
                id: turn.id,
                prompt: foldedPrompt(messages),
                config,
                maxTurns,
            })
            // 45.18 — a caller hanging up ends the run on the bridge.
            const cancel = (): void => {
                bridge.frames.push({ type: 'cancel', turn: turn.id })
            }
            signal.addEventListener('abort', cancel)
            try {
                for await (const item of turn.inbox) {
                    if (item.kind === 'event')
                        yield item.event as AssistantEvent
                    else if (item.kind === 'mcp')
                        // 45.17 — answered by the app's own MCP surface, through the turn's `Toolbox`.
                        void forwardOf(tools)(item.method, item.params)
                            .catch((thrown: unknown) =>
                                mcpFailure(-32603, String(thrown)),
                            )
                            .then((reply) => {
                                bridge.frames.push({
                                    type: 'reply',
                                    turn: turn.id,
                                    id: item.id,
                                    reply,
                                })
                            })
                    else if (item.kind === 'end') return
                    // 45.21.
                    else
                        throw refuse(502, `Claude Code failed: ${item.message}`)
                }
            } finally {
                signal.removeEventListener('abort', cancel)
                turn.close()
            }
        },
    }
}

/** The transcript as the one message Claude Code is sent: earlier turns folded above the last. 45.5. */
function foldedPrompt(messages: AssistantMessage[]): string {
    const last = (messages.at(-1) as AssistantMessage).content
    if (messages.length === 1) return last
    let earlier = ''
    for (let index = 0; index < messages.length - 1; index++) {
        const message = messages[index] as AssistantMessage
        earlier += `<${message.role}>\n${message.content}\n</${message.role}>\n`
    }
    return `<conversation>\n${earlier}</conversation>\n\n${last}`
}

/** The browser asking, which a pairing is to. 45.13. */
function askingCaller(): string {
    const caller = callerOf()
    if (caller === undefined)
        throw refuse(
            400,
            'A Claude Code bridge pairs with a browser, and this request carries none: it has to come from a page.',
        )
    return caller
}

/** The command that pairs a bridge with this browser, and when its code stops standing. 45.14. */
function bridgeCommand(): { command: string; expires: number } {
    const { code, expires } = mintCode(askingCaller())
    const site = `${appOrigin() ?? new URL(request().url).origin}${mounted('')}`
    return {
        command: `bunx @abide/bridge@${BRIDGE_VERSION} ${site} ${code}`,
        expires,
    }
}

/**
 * This browser's pairing as it changes: unpaired with the command to run, then paired the moment a
 * bridge connects, and unpaired again if it goes. 45.20.
 */
async function* bridge(): AsyncGenerator<BridgeStatus> {
    const caller = askingCaller()
    const signal = request().signal
    // A change landing while the loop was not waiting — paused at its `yield` — stays queued, so it
    // looks again; a look that finds nothing new yields nothing.
    const changes = new Inbox<undefined>()
    const waiting = changes[Symbol.asyncIterator]()
    const rouse = (): void => changes.push(undefined)
    const unwatch = watchPairing(caller, rouse)
    signal.addEventListener('abort', rouse)
    let pairing: { command: string; expires: number } | undefined
    let said = ''
    try {
        while (!signal.aborted) {
            const paired = pairedBridge(caller) !== undefined
            if (
                !paired &&
                (pairing === undefined || pairing.expires <= Date.now())
            )
                pairing = bridgeCommand()
            const status: BridgeStatus = {
                paired,
                command: paired ? undefined : pairing?.command,
            }
            const saying = `${status.paired} ${status.command}`
            if (saying !== said) {
                said = saying
                yield status
            }
            // A code that expires while nothing is paired is replaced with a fresh one.
            const renew = paired
                ? undefined
                : setTimeout(rouse, (pairing?.expires ?? 0) - Date.now())
            await waiting.next()
            clearTimeout(renew)
        }
    } finally {
        signal.removeEventListener('abort', rouse)
        unwatch()
    }
}

/** The visitor's own Claude Code as a provider, with the pairing that reaches it. */
export const claudeCode: typeof claudeCodeProvider & {
    bridge: typeof bridge
    bridgeCommand: typeof bridgeCommand
} = Object.assign(claudeCodeProvider, { bridge, bridgeCommand })
