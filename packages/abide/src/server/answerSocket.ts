// SECTION 18 — THE SOCKET MUX. Every `socket` an app mounts is carried over one web socket per browser
// (18.2), at `SOCKET_ADDRESS`, and each subscription on it is a frame naming the socket's address and
// its args. What goes back is every production of the value, numbered with the ordinal its owner
// minted (18.10, 9.14) under the value's epoch (18.11).
//
// THE FRAMES, as JSON:
//   in  { op: 'sub', id, address, args, seq?, epoch? }   a subscription, resumed where `seq` is given
//       { op: 'unsub', id }
//       { op: 'pub', id, message }                         18.6 — where `clientPublish` admits it
//   out { op: 'prod', id, seq, epoch, value }
//       { op: 'reset', id, epoch, ring: [seq, value][] }   18.14
//       { op: 'error', id, error }                         a refusal, as the four fields it is
//
// NOT HERE YET: 18.15 and 18.16, a `{#for}` keyed by sequence and cleared on a reset, which are the
// compiler's; 18.17's subscription of a `GET`; and `abide dev`, whose worker answers requests as
// messages and carries no socket. And 6.17 over a socket: a stream's replay is its CHUNKS, not the
// closed runs `history` answers, because switching the replay to runs while the live tail stays on
// chunks would number one sequence two ways, and 18.10 needs it monotonic.

import { isFailed, wireFailure } from '#shared/Failed.ts'
import { namedLogger } from '#shared/log.ts'
import { historyFrom, retained } from '#shared/reactive/History.ts'
import { pastOf } from '#shared/reactive/Reactive.ts'
import { refuse } from '#shared/refuse.ts'
import type { Socket } from '#shared/socket.ts'
import { allows, crossingOrigin } from './answerRpc.ts'
import { failureOf } from './hooks.ts'

export type Connection = {
    request: Request
    subscriptions: Map<number, () => void>
    // 18.5 — the origin a connection from another origin came from, and `null` for the app's own:
    // read once at the upgrade, since every frame on the connection shares it.
    crossing: string | null
}

export function connectionOf(request: Request): Connection {
    return {
        request,
        subscriptions: new Map(),
        crossing: crossingOrigin(request.headers.get('origin'), request.url),
    }
}

const SOCKET_LOG = namedLogger('abide:socket')

// 18.11 — ONE EPOCH PER VALUE, minted the first time the value is carried and never moved after
// (9.19). Compared for equality alone.
const EPOCHS = new WeakMap<object, string>()

function epochOf(cell: object): string {
    let epoch = EPOCHS.get(cell)
    if (epoch === undefined) {
        epoch = crypto.randomUUID()
        EPOCHS.set(cell, epoch)
    }
    return epoch
}

function send(ws: Bun.ServerWebSocket<Connection>, frame: unknown): void {
    ws.send(JSON.stringify(frame))
}

function failure(error: unknown): unknown {
    return wireFailure(failureOf(error))
}

export function socketHandlers(
    sockets: Map<string, Socket<unknown, unknown>>,
): Bun.WebSocketHandler<Connection> {
    return {
        open(ws) {
            if (SOCKET_LOG.enabled())
                SOCKET_LOG.debug('open', new URL(ws.data.request.url).pathname)
        },
        async message(ws, raw) {
            let frame: {
                op?: string
                id?: number
                address?: string
                args?: unknown
                seq?: number
                epoch?: string
                message?: unknown
            }
            try {
                frame = JSON.parse(String(raw))
            } catch {
                return
            }
            const id = frame.id ?? 0
            if (frame.op === 'unsub') {
                ws.data.subscriptions.get(id)?.()
                ws.data.subscriptions.delete(id)
                return
            }
            const carried = sockets.get(frame.address ?? '')
            if (carried === undefined) {
                send(ws, {
                    op: 'error',
                    id,
                    error: failure(
                        refuse(404, `No socket answers at ${frame.address}.`),
                    ),
                })
                return
            }
            // 18.5 — ANOTHER ORIGIN IS CLOSED OUT unless the socket declared it: the same gate, and
            // the same own origin, as a handler's (16.14, 36.2).
            const { request, crossing } = ws.data
            if (crossing !== null && !allows(carried.crossOrigin, crossing)) {
                send(ws, { op: 'error', id, error: failure(refuse(403)) })
                return
            }
            const onion = carried.onion
            try {
                if (frame.op === 'sub') {
                    // 18.3, 18.4 — the lane's rungs, and a rung refuses by throwing.
                    if (onion !== null)
                        await onion({
                            kind: 'subscribe',
                            args: frame.args,
                            request,
                        })
                    subscribe(
                        ws,
                        id,
                        carried(frame.args as never),
                        frame.seq,
                        frame.epoch,
                    )
                } else if (frame.op === 'pub') {
                    // 18.6, 18.7 — a frame from outside the process publishes only where admitted.
                    if (!carried.clientPublish)
                        throw refuse(403, 'This socket takes no publish.')
                    if (onion !== null)
                        await onion({
                            kind: 'publish',
                            args: frame.args,
                            message: frame.message,
                            request,
                        })
                    // 18.8 — through the value's own `publish`, so its `transform` runs.
                    const minted = (
                        carried(frame.args as never) as unknown as {
                            publish(value: unknown): unknown
                        }
                    ).publish(frame.message)
                    if (isFailed(minted)) throw minted
                }
            } catch (thrown) {
                send(ws, { op: 'error', id, error: failure(thrown) })
            }
        },
        close(ws) {
            for (const stop of ws.data.subscriptions.values()) stop()
            ws.data.subscriptions.clear()
        },
    }
}

// 18.13, 18.14 — A SUBSCRIPTION: what the ring holds past where the subscriber stood — all of it for
// a fresh one, and all of it marked a reset where the epoch it carried is not this value's — then
// every production after it, live.
function subscribe(
    ws: Bun.ServerWebSocket<Connection>,
    id: number,
    value: unknown,
    seq: number | undefined,
    epoch: string | undefined,
): void {
    ws.data.subscriptions.get(id)?.()
    // The past `s.history` would hand back — the adopted value's, swept of what outlived its `ttl`.
    const cell = pastOf(value)
    const current = epochOf(cell)
    const resumed = seq !== undefined && epoch === current
    const moved = seq !== undefined && epoch !== current
    const replay: [number, unknown][] = []
    // THE OLDEST PRODUCTION THE VALUE STILL RETAINS, which is where a fresh subscription starts and
    // where one older than it is clamped to (9.10).
    const floor = cell.ordinal - retained(cell)
    let at = resumed ? Math.max(seq, floor) : floor
    for (const item of historyFrom(cell, at) as Iterable<unknown>) {
        at += 1
        replay.push([at, item])
    }
    if (moved) send(ws, { op: 'reset', id, epoch: current, ring: replay })
    else
        for (const [number, item] of replay)
            send(ws, {
                op: 'prod',
                id,
                seq: number,
                epoch: current,
                value: item,
            })

    // NUMBERED BY WHERE THE CURSOR STANDS rather than by counting its turns: a cursor with no ring
    // collapses a burst onto the standing production (5.11), and that production's number is the
    // one a reconnect resumes from.
    const cursor = (historyFrom(cell, cell.ordinal) as AsyncIterable<unknown>)[
        Symbol.asyncIterator
    ]() as AsyncIterator<unknown> & { at: number }
    let stopped = false
    ws.data.subscriptions.set(id, () => {
        stopped = true
        void cursor.return?.(undefined)
    })
    void (async () => {
        for (;;) {
            const next = await cursor.next()
            if (stopped || next.done === true) return
            send(ws, {
                op: 'prod',
                id,
                seq: cursor.at,
                epoch: current,
                value: next.value,
            })
        }
    })()
}
