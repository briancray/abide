// WHAT A BRIDGE DOES WITH WHAT A SITE SENDS IT, apart from how it is sent: each turn run with this
// machine's Claude Code, each MCP request and permission prompt it makes reported for the site to
// answer, and each reply handed back to it. `bridge.ts` carries it over a server-sent stream and posts; the native app's own
// bridge (44.77) carries it in its own process — one core, so a frame either learns is one both learn.

import type { ProviderEvent } from '@abide/abide/server'

import { claudeTurn, type TurnRequest } from './claudeTurn.ts'
import { PERMISSION_SERVER } from './grant.ts'

// 44.24 — how long a relayed MCP request waits for the site's reply.
const REPLY_MILLISECONDS = 120_000

/** What a site sends a bridge about its turns. */
export type TurnFrame =
    | ({ type: 'turn' } & TurnRequest)
    | {
          type: 'reply'
          turn: string
          id: number
          reply: Record<string, unknown>
      }
    | { type: 'cancel'; turn: string }
    | { type: 'permit'; turn: string; id: number; allow: boolean }

/** What a bridge reports of a turn. */
export type TurnReport =
    | { type: 'event'; turn: string; event: ProviderEvent }
    | {
          type: 'mcp'
          turn: string
          id: number
          method: string
          params: unknown
      }
    | {
          type: 'permission'
          turn: string
          id: number
          name: string
          input: unknown
      }
    | { type: 'end'; turn: string }
    | { type: 'fail'; turn: string; message: string }

/** A relayed MCP request the site has yet to reply to. */
type Waiting = {
    turn: string
    method: string
    answer: (reply: Record<string, unknown>) => void
    deadline: ReturnType<typeof setTimeout>
}

/** 44.46 — the abort reason of a turn the site missed part of, which it reports failed with. */
class MissedTurn extends Error {}

/** A permission prompt's answer, as Claude Code reads its `--permission-prompt-tool`'s text. 44.81. */
function decided(
    allow: boolean,
    input: unknown,
    message: string,
): Record<string, unknown> {
    const decision = allow
        ? { behavior: 'allow', updatedInput: input }
        : { behavior: 'deny', message }
    return {
        result: { content: [{ type: 'text', text: JSON.stringify(decision) }] },
    }
}

/**
 * What Claude Code is answered where the site never replied: a prompt denied, a failed call, or a
 * JSON-RPC error.
 */
function unanswered(method: string, message: string): Record<string, unknown> {
    if (method === 'permission') return decided(false, undefined, message)
    return method === 'tools/call'
        ? {
              result: {
                  content: [{ type: 'text', text: message }],
                  isError: true,
              },
          }
        : { error: { code: -32603, message } }
}

/** What the bridge's own permission server answers Claude Code, short of a prompt. 44.81. */
function permissionServer(method: string, params: unknown): unknown {
    if (method === 'initialize')
        return {
            protocolVersion: (params as { protocolVersion?: string })
                ?.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: PERMISSION_SERVER, version: '1' },
        }
    if (method === 'tools/list')
        return {
            tools: [
                {
                    name: 'ask',
                    description:
                        'Asks the person at the page whether a tool call may run.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            tool_name: { type: 'string' },
                            input: { type: 'object' },
                            tool_use_id: { type: 'string' },
                        },
                    },
                },
            ],
        }
    return {}
}

/**
 * Serves the turns `site` sends, reporting each through `report`.
 *
 * `full` gives a turn everything `claude` has, as the visitor running the native app has (44.78,
 * 44.82); otherwise the visitor's `--tools` in `claudeArgs` narrows what a turn asks for (44.29).
 * `beforeTurn` runs ahead of each turn.
 */
export function serveTurns(options: {
    site: string
    claude: string
    claudeArgs: string[]
    full: boolean
    report: (report: TurnReport) => void
    say: (line: string) => void
    beforeTurn: () => Promise<void>
    replyMilliseconds?: number
}): {
    /** Hands the core a frame the site sent. */
    take: (frame: TurnFrame) => void
    /** Ends `turn`, reporting it failed with `message`. 44.46. */
    miss: (turn: string, message: string) => void
    /** Ends every turn, the way a cancel does. */
    cancelAll: () => void
    /** Ends every turn and stops the MCP server. */
    stop: () => void
} {
    const { site, report } = options
    const replyMilliseconds = options.replyMilliseconds ?? REPLY_MILLISECONDS
    const waiting = new Map<number, Waiting>()
    // Each prompt's input, handed back as Claude Code's `updatedInput` where the page allows it.
    const inputs = new Map<number, unknown>()
    const answer = (id: number, reply: Record<string, unknown>): void => {
        const waiter = waiting.get(id)
        if (waiter === undefined) return
        waiting.delete(id)
        inputs.delete(id)
        clearTimeout(waiter.deadline)
        waiter.answer(reply)
    }
    const turns = new Map<string, AbortController>()
    let asked = 0
    const secret = crypto.randomUUID()
    // TOOLS ARE RELAYED, NEVER CALLED FROM HERE: Claude Code is handed an MCP server on loopback, behind
    // a path no other process is told, and each request it makes there is reported for the site to
    // answer. Beside it, under `/permission`, the server whose one tool is each permission prompt
    // (44.81): answered here but for the prompt itself, which is reported for the page to answer.
    const shim = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        // A tool call takes as long as its handler does: the reply deadline (44.24) bounds the wait,
        // where bun's own idle timeout would cut every call past 10 seconds.
        idleTimeout: 0,
        async fetch(request) {
            const [, given, turn, server] = new URL(request.url).pathname.split(
                '/',
            )
            if (
                given !== secret ||
                turn === undefined ||
                !turns.has(turn) ||
                (server !== undefined && server !== 'permission')
            )
                return new Response(null, { status: 404 })
            if (request.method !== 'POST')
                return new Response(null, {
                    status: 405,
                    headers: { allow: 'POST' },
                })
            const message = (await request.json()) as {
                id?: number | string
                method: string
                params?: unknown
            }
            // A notification is acknowledged here; there is nothing for the site to answer.
            if (message.id === undefined)
                return new Response(null, { status: 202 })
            const prompted =
                server === 'permission' && message.method === 'tools/call'
            if (server === 'permission' && !prompted)
                return Response.json({
                    jsonrpc: '2.0',
                    id: message.id,
                    result: permissionServer(message.method, message.params),
                })
            const id = ++asked
            const method = prompted ? 'permission' : message.method
            const reply = new Promise<Record<string, unknown>>((done) => {
                waiting.set(id, {
                    turn,
                    method,
                    answer: done,
                    // 44.24 — a reply lost on the way is a failure Claude Code is told of.
                    deadline: setTimeout(
                        () =>
                            answer(
                                id,
                                unanswered(
                                    method,
                                    `${site} sent no reply within ${replyMilliseconds} ms.`,
                                ),
                            ),
                        replyMilliseconds,
                    ),
                })
            })
            if (prompted) {
                const { tool_name, input } = ((
                    message.params as { arguments?: unknown }
                )?.arguments ?? {}) as { tool_name?: string; input?: unknown }
                inputs.set(id, input)
                report({
                    type: 'permission',
                    turn,
                    id,
                    name: tool_name ?? '',
                    input,
                })
            } else
                report({
                    type: 'mcp',
                    turn,
                    id,
                    method: message.method,
                    params: message.params,
                })
            return Response.json({
                jsonrpc: '2.0',
                id: message.id,
                ...(await reply),
            })
        },
    })

    const run = async (turn: TurnRequest): Promise<void> => {
        const controller = new AbortController()
        turns.set(turn.id, controller)
        await options.beforeTurn()
        // A cancel or a signal aborts with no reason of its own, and ends the turn as asked.
        const missed = (): string | undefined =>
            controller.signal.reason instanceof MissedTurn
                ? controller.signal.reason.message
                : undefined
        try {
            await claudeTurn(turn, {
                claude: options.claude,
                claudeArgs: options.claudeArgs,
                full: options.full,
                mcpUrl: `http://127.0.0.1:${shim.port}/${secret}/${turn.id}`,
                signal: controller.signal,
                report: (event) =>
                    report({ type: 'event', turn: turn.id, event }),
                say: options.say,
            })
            const message = missed()
            if (message === undefined) report({ type: 'end', turn: turn.id })
            else report({ type: 'fail', turn: turn.id, message })
        } catch (thrown) {
            report({
                type: 'fail',
                turn: turn.id,
                message:
                    missed() ??
                    (thrown instanceof Error ? thrown.message : String(thrown)),
            })
        } finally {
            turns.delete(turn.id)
            for (const [id, waiter] of waiting)
                if (waiter.turn === turn.id)
                    answer(id, unanswered(waiter.method, 'The turn ended.'))
        }
    }

    const cancelAll = (): void => {
        for (const controller of turns.values()) controller.abort()
    }
    return {
        take(frame) {
            if (frame.type === 'turn') void run(frame)
            else if (frame.type === 'reply') {
                // A reply answers an MCP request, and a permit a prompt: neither stands in for the other.
                if (waiting.get(frame.id)?.method !== 'permission')
                    answer(frame.id, frame.reply)
            } else if (frame.type === 'permit') {
                const waiter = waiting.get(frame.id)
                if (
                    waiter?.method !== 'permission' ||
                    waiter.turn !== frame.turn
                )
                    return
                answer(
                    frame.id,
                    decided(
                        frame.allow,
                        inputs.get(frame.id),
                        'The person at the page said no.',
                    ),
                )
            } else turns.get(frame.turn)?.abort()
        },
        miss(turn, message) {
            turns.get(turn)?.abort(new MissedTurn(message))
        },
        cancelAll,
        stop() {
            cancelAll()
            shim.stop(true)
        },
    }
}
