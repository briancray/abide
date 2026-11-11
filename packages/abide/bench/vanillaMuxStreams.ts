// THE MUX ARM, hand-written: every stream a page reads multiplexed by id over ONE web socket, with
// the caller read once off the upgrade — the per-browser channel, at its smallest. A frame in is
// `{op:'stream',id,n}` or `{op:'unsub',id}`; a frame out is `{op:'chunk',id,value}` or `{op:'end',id}`.

import type { Server, ServerWebSocket } from 'bun'

type Connection = { caller: string; streams: Map<number, AbortController> }

/** The server half: the upgrade, and each stream pumped onto the socket that asked for it. */
export function muxStreamServer() {
    return {
        fetch(request: Request, server: Server<Connection>) {
            const caller =
                /caller=([^;]+)/.exec(
                    request.headers.get('cookie') ?? '',
                )?.[1] ?? ''
            if (
                server.upgrade(request, {
                    data: { caller, streams: new Map() },
                })
            )
                return
            return new Response('expected a websocket', { status: 400 })
        },
        websocket: {
            async message(
                socket: ServerWebSocket<Connection>,
                raw: string | Buffer,
            ) {
                const frame = JSON.parse(String(raw))
                const streams = socket.data.streams
                if (frame.op === 'unsub') return streams.get(frame.id)?.abort()
                const stop = new AbortController()
                streams.set(frame.id, stop)
                for (let at = 0; at < frame.n && !stop.signal.aborted; at++) {
                    await Bun.sleep(1)
                    socket.send(
                        `{"op":"chunk","id":${frame.id},"value":${JSON.stringify({ at })}}`,
                    )
                }
                streams.delete(frame.id)
                socket.send(`{"op":"end","id":${frame.id}}`)
            },
            close(socket: ServerWebSocket<Connection>) {
                for (const stop of socket.data.streams.values()) stop.abort()
            },
        },
    }
}

/** The client half: one socket, and a stream per id read off it as its chunks land. */
export class MuxClient {
    private readonly socket: WebSocket
    private readonly opened: Promise<unknown>
    private readonly queues = new Map<
        number,
        { chunks: unknown[]; ended: boolean; wake: () => void }
    >()
    private nextId = 1

    constructor(url: string) {
        this.socket = new WebSocket(url)
        this.opened = new Promise((resolve) => (this.socket.onopen = resolve))
        this.socket.onmessage = (event) => {
            const frame = JSON.parse(String(event.data))
            const queue = this.queues.get(frame.id)
            if (queue === undefined) return
            if (frame.op === 'chunk') queue.chunks.push(frame.value)
            else queue.ended = true
            queue.wake()
        }
    }

    async *stream(count: number): AsyncGenerator<unknown> {
        await this.opened
        const id = this.nextId++
        const queue = { chunks: [] as unknown[], ended: false, wake: () => {} }
        this.queues.set(id, queue)
        this.socket.send(JSON.stringify({ op: 'stream', id, n: count }))
        try {
            while (true) {
                if (queue.chunks.length > 0) {
                    yield queue.chunks.shift()
                    continue
                }
                if (queue.ended) return
                await new Promise<void>((wake) => (queue.wake = wake))
            }
        } finally {
            this.queues.delete(id)
            if (!queue.ended)
                this.socket.send(JSON.stringify({ op: 'unsub', id }))
        }
    }

    close(): void {
        this.socket.close()
    }
}
