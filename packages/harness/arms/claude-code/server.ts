// THE RELAY, BY HAND. A page cannot reach a program on its reader's machine,
// so the bridge dials out to here, and everything between the two — the
// pairing code, which browser it pairs, the turn sent down and the events
// sent back — is this file's to keep.
const CODE_LIFETIME = 10 * 60_000
const SITE = 'http://localhost:3000'

type Lines = ReadableStreamDefaultController<string>
type Bridge = { frames: Lines; turns: Map<string, Lines> }

const codes = new Map<string, { caller: string; expires: number }>()
const bridges = new Map<string, Bridge>()
const watchers = new Map<string, Set<() => void>>()

function callerOf(request: Request): string | undefined {
    const cookie = request.headers.get('cookie') ?? ''
    return /(?:^|; )caller=([^;]+)/.exec(cookie)?.[1]
}

function wake(caller: string): void {
    for (const watcher of watchers.get(caller) ?? []) watcher()
}

function linesOut(
    start: (send: (value: unknown) => void, lines: Lines) => void,
    headers: Record<string, string> = {},
): Response {
    const stream = new ReadableStream<string>({
        start: (lines) =>
            start(
                (value) => lines.enqueue(`${JSON.stringify(value)}\n`),
                lines,
            ),
    })
    return new Response(stream.pipeThrough(new TextEncoderStream()), {
        headers: { 'content-type': 'application/jsonl', ...headers },
    })
}

// The transcript as one message, earlier turns folded above the last.
function folded(messages: { role: string; content: string }[]): string {
    const last = messages.at(-1)?.content ?? ''
    let earlier = ''
    for (const message of messages.slice(0, -1))
        earlier += `<${message.role}>\n${message.content}\n</${message.role}>\n`
    return earlier === ''
        ? last
        : `<conversation>\n${earlier}</conversation>\n\n${last}`
}

Bun.serve({
    routes: {
        // This browser's pairing as it changes, with a fresh caller where it has none.
        '/api/bridge': (request) => {
            const caller = callerOf(request) ?? crypto.randomUUID()
            const code = crypto.randomUUID().slice(0, 16)
            codes.set(code, { caller, expires: Date.now() + CODE_LIFETIME })
            return linesOut(
                (send) => {
                    const say = () =>
                        send(
                            bridges.has(caller)
                                ? { paired: true }
                                : {
                                      paired: false,
                                      command: `bunx abide-bridge@0.1.0 ${SITE} ${code}`,
                                  },
                        )
                    const mine = watchers.get(caller) ?? new Set()
                    mine.add(say)
                    watchers.set(caller, mine)
                    say()
                },
                {
                    'set-cookie': `caller=${caller}; HttpOnly; SameSite=Lax; Path=/`,
                },
            )
        },
        // The bridge dials in with its code, and is sent each turn down this stream.
        '/bridge': {
            GET: (request) => {
                const code = new URL(request.url).searchParams.get('code') ?? ''
                const pairing = codes.get(code)
                codes.delete(code)
                if (pairing === undefined || pairing.expires <= Date.now())
                    return new Response('That code has expired.', {
                        status: 410,
                    })
                return linesOut((_send, frames) => {
                    bridges.set(pairing.caller, { frames, turns: new Map() })
                    wake(pairing.caller)
                })
            },
            // What the bridge reports: one turn's events, then its end.
            POST: async (request) => {
                const { caller, turn, event } = (await request.json()) as {
                    caller: string
                    turn: string
                    event: { type: string }
                }
                const lines = bridges.get(caller)?.turns.get(turn)
                if (event.type === 'end') lines?.close()
                else lines?.enqueue(`${JSON.stringify(event)}\n`)
                return new Response(null, { status: 204 })
            },
        },
        '/api/ask': {
            POST: async (request) => {
                const bridge = bridges.get(callerOf(request) ?? '')
                if (bridge === undefined)
                    return new Response(
                        'No Claude Code is paired with this browser.',
                        { status: 409 },
                    )
                const { messages } = (await request.json()) as {
                    messages: { role: string; content: string }[]
                }
                const turn = crypto.randomUUID()
                const caller = callerOf(request)
                return linesOut((_send, lines) => {
                    bridge.turns.set(turn, lines)
                    bridge.frames.enqueue(
                        `${JSON.stringify({ type: 'turn', caller, turn, prompt: folded(messages) })}\n`,
                    )
                })
            },
        },
    },
})
