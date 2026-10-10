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

/** Pairs with `site` by `code`, and serves its turns until the site or the stream ends it. */
export async function bridge(options: {
    site: string
    code: string
    claude?: string
    say?: (line: string) => void
}): Promise<void> {
    const site = options.site.replace(/\/+$/, '')
    const say = options.say ?? ((line: string) => console.error(line))
    const paired = await fetch(
        `${site}${BRIDGE_PATH}?code=${encodeURIComponent(options.code)}`,
        { headers: { accept: 'text/event-stream' } },
    )
    if (!paired.ok || paired.body === null)
        throw new Error(
            `${site} refused the pairing (${paired.status}): ${await paired.text()}`,
        )

    let token = ''
    const outbox: string[] = []
    let flushing: Promise<void> = Promise.resolve()
    let scheduled = false
    const flush = async (): Promise<void> => {
        scheduled = false
        const body = outbox.splice(0).join('\n')
        if (body === '') return
        await fetch(`${site}${BRIDGE_PATH}`, {
            method: 'POST',
            headers: {
                authorization: `Bearer ${token}`,
                'content-type': 'application/jsonl',
            },
            body,
        }).catch(() => {})
    }
    // One post at a time, in order: a turn's `end` never overtakes its last event.
    const report = (item: Report): void => {
        outbox.push(JSON.stringify(item))
        if (scheduled) return
        scheduled = true
        setTimeout(() => {
            flushing = flushing.then(flush)
        }, BATCH_MILLISECONDS)
    }

    const turns = new Map<string, AbortController>()
    const waiting = new Map<number, (reply: Record<string, unknown>) => void>()
    let asked = 0
    const secret = crypto.randomUUID()
    const shim = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
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
            const reply = new Promise<Record<string, unknown>>((done) => {
                waiting.set(id, done)
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
                mcpUrl: `http://127.0.0.1:${shim.port}/${secret}/${turn.id}`,
                signal: controller.signal,
                report: (event) =>
                    report({ type: 'event', turn: turn.id, event }),
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
        }
    }

    try {
        for await (const line of readLines(paired.body)) {
            if (!line.startsWith('data: ')) continue
            const frame = JSON.parse(line.slice('data: '.length)) as SiteFrame
            if (frame.type === 'paired') {
                token = frame.token
                say(
                    `Connected to ${site}. Keep this running while you chat; it ends when you close the page.`,
                )
            } else if (frame.type === 'turn') void run(frame)
            else if (frame.type === 'reply') {
                waiting.get(frame.id)?.(frame.reply)
                waiting.delete(frame.id)
            } else if (frame.type === 'cancel') turns.get(frame.turn)?.abort()
            else if (frame.type === 'bye') break
        }
    } finally {
        for (const controller of turns.values()) controller.abort()
        await flushing
        await flush()
        shim.stop(true)
        say(`Disconnected from ${site}.`)
    }
}
