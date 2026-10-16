// THE BRIDGE: this machine's Claude Code, lent to one browser on one abide site. It dials OUT — a page
// cannot reach a process on its own machine from https — and holds a server-sent stream open to the
// site, which sends it turns; what it reports goes back as posts.
//
// TOOLS ARE RELAYED, NEVER CALLED FROM HERE. Claude Code is handed an MCP server on loopback, behind a
// path no other process is told; each request it makes there is posted to the site, which answers it
// inside the page's own request, as the person at the page. No credential of theirs reaches this
// machine, and none of this machine's reaches the site.

import type { AssistantEvent } from '@abide/abide/server'
import { claudeTurn, type TurnRequest } from './claudeTurn.ts'
import { readLines } from './readLines.ts'

// abide's `BRIDGE_ADDRESS`, spelled out because the bridge carries no abide at run time — a test
// holds the two equal.
export const BRIDGE_PATH = '/__abide/bridge'
// How long reports gather before they are posted, so a streamed reply is not a post per token.
const BATCH_MILLISECONDS = 15
// 44.24 — how long a relayed MCP request waits for the site's reply.
const REPLY_MILLISECONDS = 120_000
// 44.25 — the first wait before redialing a dropped stream, doubled per failed dial up to the last.
const FIRST_REDIAL_MILLISECONDS = 250
const LAST_REDIAL_MILLISECONDS = 8_000
// abide's `RESUME_MILLISECONDS`, spelled out for `BRIDGE_PATH`'s reason: past it the site no longer
// holds the pairing, and a redial is refused.
export const RESUME_MILLISECONDS = 30_000
// abide's `HEARTBEAT_MILLISECONDS`, spelled out for `BRIDGE_PATH`'s reason.
export const HEARTBEAT_MILLISECONDS = 15_000
// 44.28 — how long the stream may go without a line before it is taken for dropped.
const SILENCE_MILLISECONDS = 3 * HEARTBEAT_MILLISECONDS

type SiteFrame =
    | { type: 'paired'; token: string }
    | ({ type: 'turn' } & TurnRequest)
    | {
          type: 'reply'
          turn: string
          id: number
          reply: Record<string, unknown>
      }
    | { type: 'cancel'; turn: string }
    | { type: 'bye' }

type Report =
    | { type: 'event'; turn: string; event: AssistantEvent }
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

/** Pairs with `site` by `code`, and serves its turns until the site or the stream ends it. */
export async function bridge(options: {
    site: string
    code: string
    claude?: string
    claudeArgs?: string[]
    say?: (line: string) => void
    replyMilliseconds?: number
    silenceMilliseconds?: number
}): Promise<void> {
    const site = options.site.replace(/\/+$/, '')
    const say = options.say ?? ((line: string) => console.error(line))
    const replyMilliseconds = options.replyMilliseconds ?? REPLY_MILLISECONDS
    const silenceMilliseconds =
        options.silenceMilliseconds ?? SILENCE_MILLISECONDS
    // What cuts the stream being read, where it went silent.
    let dialed = new AbortController()
    let stream = await fetch(
        `${site}${BRIDGE_PATH}?code=${encodeURIComponent(options.code)}`,
        {
            headers: { accept: 'text/event-stream' },
            signal: dialed.signal,
        },
    )
    if (!stream.ok || stream.body === null)
        throw new Error(
            `${site} refused the pairing (${stream.status}): ${await stream.text()}`,
        )

    let token = ''
    const waiting = new Map<number, Waiting>()
    const answer = (id: number, reply: Record<string, unknown>): void => {
        const waiter = waiting.get(id)
        if (waiter === undefined) return
        waiting.delete(id)
        clearTimeout(waiter.deadline)
        waiter.answer(reply)
    }
    const outbox: Report[] = []
    let flushing: Promise<void> = Promise.resolve()
    let scheduled = false
    const flush = async (): Promise<void> => {
        scheduled = false
        const batch = outbox.splice(0)
        if (batch.length === 0) return
        const lines: string[] = []
        for (const item of batch) lines.push(JSON.stringify(item))
        let failure: string | undefined
        try {
            const posted = await fetch(`${site}${BRIDGE_PATH}`, {
                method: 'POST',
                headers: {
                    authorization: `Bearer ${token}`,
                    'content-type': 'application/jsonl',
                },
                body: lines.join('\n'),
            })
            if (!posted.ok)
                failure = `${site} refused a report (${posted.status}): ${await posted.text()}`
            else await posted.body?.cancel()
        } catch (thrown) {
            failure = `${site} could not be reached: ${thrown instanceof Error ? thrown.message : String(thrown)}`
        }
        if (failure === undefined) return
        say(failure)
        // 44.24 — a request the site never heard of is answered failed rather than waited on.
        for (const item of batch)
            if (item.type === 'mcp')
                answer(item.id, unanswered(item.method, failure))
    }
    // One post at a time, in order: a turn's `end` never overtakes its last event.
    const report = (item: Report): void => {
        outbox.push(item)
        if (scheduled) return
        scheduled = true
        setTimeout(() => {
            flushing = flushing.then(flush)
        }, BATCH_MILLISECONDS)
    }

    // A notice a turn repeats is said once, not once per turn.
    const said = new Set<string>()
    const sayOnce = (line: string): void => {
        if (said.has(line)) return
        said.add(line)
        say(line)
    }

    const turns = new Map<string, AbortController>()
    let asked = 0
    const secret = crypto.randomUUID()
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
        try {
            await claudeTurn(turn, {
                claude: options.claude ?? 'claude',
                claudeArgs: options.claudeArgs ?? [],
                mcpUrl: `http://127.0.0.1:${shim.port}/${secret}/${turn.id}`,
                signal: controller.signal,
                report: (event) =>
                    report({ type: 'event', turn: turn.id, event }),
                say: sayOnce,
            })
            report({ type: 'end', turn: turn.id })
        } catch (thrown) {
            report({
                type: 'fail',
                turn: turn.id,
                message:
                    thrown instanceof Error ? thrown.message : String(thrown),
            })
        } finally {
            turns.delete(turn.id)
            for (const [id, waiter] of waiting)
                if (waiter.turn === turn.id)
                    answer(id, unanswered(waiter.method, 'The turn ended.'))
        }
    }

    // 44.25 — THE STREAM REDIALED BY ITS TOKEN, each wait twice the last, until the site refuses it or
    // stops holding the pairing.
    const redial = async (): Promise<Response | undefined> => {
        if (token === '') return undefined
        say(`Lost ${site}; reconnecting.`)
        const until = Date.now() + RESUME_MILLISECONDS
        let delay = FIRST_REDIAL_MILLISECONDS
        while (Date.now() < until) {
            await Bun.sleep(delay)
            delay = Math.min(delay * 2, LAST_REDIAL_MILLISECONDS)
            try {
                dialed = new AbortController()
                const resumed = await fetch(`${site}${BRIDGE_PATH}`, {
                    headers: {
                        accept: 'text/event-stream',
                        authorization: `Bearer ${token}`,
                    },
                    signal: dialed.signal,
                })
                if (resumed.ok && resumed.body !== null) {
                    say(`Reconnected to ${site}.`)
                    return resumed
                }
                await resumed.body?.cancel()
                if (resumed.status < 500) return undefined
            } catch {
                // Unreachable for now: the next dial is the retry.
            }
        }
        return undefined
    }

    try {
        let bye = false
        for (;;) {
            // 44.28 — a stream silent past the bound is cut, and redialed as one that dropped.
            const silence = setTimeout(
                () => dialed.abort(),
                silenceMilliseconds,
            )
            try {
                for await (const line of readLines(
                    stream.body as ReadableStream<Uint8Array>,
                )) {
                    silence.refresh()
                    if (!line.startsWith('data: ')) continue
                    const frame = JSON.parse(
                        line.slice('data: '.length),
                    ) as SiteFrame
                    if (frame.type === 'paired') {
                        token = frame.token
                        say(
                            `Connected to ${site}. Keep this running while you chat; it ends when you close the page.`,
                        )
                    } else if (frame.type === 'turn') void run(frame)
                    else if (frame.type === 'reply')
                        answer(frame.id, frame.reply)
                    else if (frame.type === 'cancel')
                        turns.get(frame.turn)?.abort()
                    else if (frame.type === 'bye') {
                        bye = true
                        break
                    }
                }
            } catch {
                // A stream cut mid-read is a drop like one that ended.
            } finally {
                clearTimeout(silence)
            }
            if (bye) break
            const resumed = await redial()
            if (resumed === undefined) break
            stream = resumed
        }
    } finally {
        for (const controller of turns.values()) controller.abort()
        await flushing
        await flush()
        shim.stop(true)
        say(`Disconnected from ${site}.`)
    }
}
