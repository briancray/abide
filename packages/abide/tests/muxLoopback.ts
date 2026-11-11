// A MUX THAT ANSWERS IN THIS PROCESS, for a test whose `fetch` is the server: the browser's socket is
// a stand-in whose `stream` frames are answered by the server's own `streamOverMux` through whatever
// `fetch` stands at the time, and whose frames back land on the browser's mux as a socket's would.
// So a test of what a streaming copy does with its answer drives both halves of 16.93 while still
// writing the answer as a `Response`. Every other frame — a follow (18.3) — is taken and ignored.

import { streamOverMux } from '#server/streamOverMux.ts'

type Answer = (request: Request) => Promise<Response>

// THE BROWSER'S COOKIE, which its socket's upgrade carries and a request it makes over http has to as
// well: what an answer the mux parks is filed under (16.98).
const LOOPBACK_COOKIE = 'abide-caller=loopback-browser'

/** `request` as the loopback's browser makes it: carrying its cookie. */
export function fromLoopbackBrowser(request: Request): Request {
    const headers = new Headers(request.headers)
    headers.set('cookie', LOOPBACK_COOKIE)
    return new Request(request, { headers })
}

// What answers a `stream` frame: the `fetch` standing at the time, unless one was installed.
let answering: Answer | undefined

class LoopbackSocket {
    static OPEN = 1
    readyState = 0
    onopen: (() => void) | null = null
    onmessage: ((event: { data: string }) => void) | null = null
    onclose: (() => void) | null = null
    onerror: (() => void) | null = null
    private readonly streams = new Map<number, AbortController>()
    private readonly upgrade: Request

    constructor(url: string) {
        this.upgrade = new Request(url.replace(/^ws/, 'http'), {
            headers: { cookie: LOOPBACK_COOKIE },
        })
        queueMicrotask(() => {
            this.readyState = LoopbackSocket.OPEN
            this.onopen?.()
        })
    }

    send(text: string): void {
        const frame = JSON.parse(text) as {
            op: string
            id: number
            url?: string
        }
        if (frame.op === 'unsub') this.streams.get(frame.id)?.abort()
        if (frame.op !== 'stream') return
        const ending = new AbortController()
        this.streams.set(frame.id, ending)
        void streamOverMux(
            {
                peer: {
                    send: (id, sent) => {
                        if (this.readyState === LoopbackSocket.OPEN)
                            queueMicrotask(() =>
                                this.onmessage?.({ data: sent.json(id) }),
                            )
                        return 1
                    },
                    close: () => {},
                },
                drained: () => Promise.resolve(),
            },
            frame.id,
            frame.url ?? '',
            this.upgrade,
            answering ??
                ((request) =>
                    globalThis.fetch(request.url, { signal: request.signal })),
            ending.signal,
        )
    }

    close(): void {
        this.readyState = 3
        for (const ending of this.streams.values()) ending.abort()
    }
}

/**
 * Stands the loopback in for `WebSocket`, its streams answered by `answer` where given; returns what
 * puts the one before it back.
 */
export function installMuxLoopback(answer?: Answer): () => void {
    const previous = globalThis.WebSocket
    globalThis.WebSocket = LoopbackSocket as unknown as typeof WebSocket
    answering = answer
    return () => {
        globalThis.WebSocket = previous
        answering = undefined
    }
}
