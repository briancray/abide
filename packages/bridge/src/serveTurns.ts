// WHAT A BRIDGE DOES WITH WHAT A SITE SENDS IT, apart from how it is sent: each turn run with this
// machine's Claude Code, each MCP request it makes reported for the site to answer, and each reply
// handed back to it. `bridge.ts` carries it over a server-sent stream and posts; the desktop app's own
// bridge (44.77) carries it in its own process — one core, so a frame either learns is one both learn.

import type { ProviderEvent } from '@abide/abide/server'

import { claudeTurn, type TurnRequest } from './claudeTurn.ts'

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

/** What Claude Code is answered where the site never replied: a failed call, or a JSON-RPC error. */
function unanswered(method: string, message: string): Record<string, unknown> {
    return method === 'tools/call'
        ? {
              result: {
                  content: [{ type: 'text', text: message }],
                  isError: true,
              },
          }
        : { error: { code: -32603, message } }
}

/**
 * Serves the turns `site` sends, reporting each through `report`.
 *
 * `trusted` grants every tool a turn asks for, as the visitor running the desktop app has (44.78);
 * otherwise the visitor's `--tools` in `claudeArgs` narrows them (44.29). `beforeTurn` runs ahead of
 * each turn.
 */
export function serveTurns(options: {
    site: string
    claude: string
    claudeArgs: string[]
    trusted: boolean
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
    const answer = (id: number, reply: Record<string, unknown>): void => {
        const waiter = waiting.get(id)
        if (waiter === undefined) return
        waiting.delete(id)
        clearTimeout(waiter.deadline)
        waiter.answer(reply)
    }
    const turns = new Map<string, AbortController>()
    let asked = 0
    const secret = crypto.randomUUID()
    // TOOLS ARE RELAYED, NEVER CALLED FROM HERE: Claude Code is handed an MCP server on loopback, behind
    // a path no other process is told, and each request it makes there is reported for the site to answer.
    const shim = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        // A tool call takes as long as its handler does: the reply deadline (44.24) bounds the wait,
        // where bun's own idle timeout would cut every call past 10 seconds.
        idleTimeout: 0,
        async fetch(request) {
            const [, given, turn] = new URL(request.url).pathname.split('/')
            if (given !== secret || turn === undefined || !turns.has(turn))
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
            const id = ++asked
            const method = message.method
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
                trusted: options.trusted,
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
            else if (frame.type === 'reply') answer(frame.id, frame.reply)
            else turns.get(frame.turn)?.abort()
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
