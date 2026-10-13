// 18.16, 18.17, 18.18 — A FRAME ON THE MUX IS ANSWERED IN ITS CONNECTION'S SCOPE, made from the upgrade
// request: a guarded `GET`'s rung, run once as a follow opens (18.8), reads `request()` as an http
// rung does, and a rung that throws once its client hung up is a refused follow rather than a fault
// (18.8).

import { expect, test } from 'bun:test'
import { Mux, type MuxConnection } from '#server/answerSocket.ts'
import type { BootedApp } from '#server/createApp.ts'
import { onError } from '#server/hooks.ts'
import { installServer } from '#server/installServer.ts'
import {
    currentRequestScope,
    request,
    requestCookies,
    response,
} from '#server/requestScope.ts'
import { reactive, watch } from '#shared'
import type { Middleware } from '#shared/Middleware.ts'
import { GET } from '#shared/rpc.ts'
import { inMemoryApp } from './inMemoryApp.ts'

installServer()

const ADDRESS = '/room'

type Frame = { op: string; id?: number; error?: { status: number } }

/** A `GET` over a `global` value behind `middleware`, mounted at `ADDRESS` on a mux of its own. */
function guarded(middleware: Middleware<never, unknown>[]): Mux {
    const handler = GET(reactive<string>('secret', { global: true }), {
        middleware: middleware as never,
    }) as unknown as { address: string }
    handler.address = ADDRESS
    return new Mux(
        new Map([
            [
                `GET ${ADDRESS}`,
                { handler, ui: true, route: '/', rungs: [] } as never,
            ],
        ]),
        undefined,
    )
}

/** A connection to `mux`, upgraded with `headers`, recording every frame it is sent. */
function connected(
    mux: Mux,
    headers: Record<string, string> = {},
): { connection: MuxConnection; sent: Frame[] } {
    const sent: Frame[] = []
    const connection = mux.connect(
        new Request('http://app.test/__abide/socket', { headers }),
        {
            send(text: string) {
                sent.push(JSON.parse(text))
            },
            close() {},
        },
    )
    return { connection, sent }
}

const SUBSCRIBE = JSON.stringify({ op: 'sub', id: 1, address: ADDRESS })

async function turns(): Promise<void> {
    for (let turn = 0; turn < 10; turn++) await Promise.resolve()
}

// THE REVERT: answer the frame outside the scope (`message` calling `answerFrame` directly);
// `request()` throws 22.1's error in the rung, which refuses the follow, and `seen` stays undefined.
test('a rung reads the upgrade request through request() as a follow opens — 18.16, 18.8', async () => {
    let seen: string | null | undefined
    const { connection, sent } = connected(
        guarded([
            async (next) => {
                seen = request().headers.get('x-reader')
                return next()
            },
        ]),
        { 'x-reader': 'ada' },
    )
    await connection.message(SUBSCRIBE)
    await turns()
    expect(seen).toBe('ada')
    // Admitted, so fed the value.
    expect(sent.map((frame) => frame.op)).toEqual(['value'])
    connection.close()
})

// 18.8 — A RUNG THAT THROWS ONCE ITS CONNECTION CLOSED was handed the cancellation: its signal has
// aborted, and the throw is neither sent nor reported. THE REVERT: leave the upgrade's signal standing
// at the close (drop `hangUp.abort()` in `close`); the rung reads `aborted: false`.
test('the signal a rung reads aborts when its connection closes, and its throw is no fault — 18.18, 18.8', async () => {
    let release: () => void = () => {}
    let aborted: boolean | undefined
    const reported: unknown[] = []
    const unfile = onError((error) => void reported.push(error))
    const { connection, sent } = connected(
        guarded([
            async () => {
                await new Promise<void>((done) => {
                    release = done
                })
                aborted = request().signal.aborted
                throw new Error('the upstream went away with the client')
            },
        ]),
    )
    const answering = connection.message(SUBSCRIBE)
    connection.close()
    release()
    await answering
    await turns()
    unfile()
    expect({ aborted, sent, reported: reported.length }).toEqual({
        aborted: true,
        sent: [],
        reported: 0,
    })
})

// 12.5 — a watch a rung opened is the connection's, and stops when it closes, whether the rung
// opened it past an await or in its synchronous start — which runs inside the handler entry's
// construction. THE REVERT: leave the scope unreleased at the close (drop `releaseScope` in
// `close`); the disposer never runs and `disposed` stays `[false, false]`. And for the synchronous
// open alone, build the entry under `unowned` in `Keyed`, as it was: `[false, true]`.
test('a watch a rung opened as a follow opened is disposed when its connection closes — 18.17, 12.5', async () => {
    const disposedWhen = async (awaitFirst: boolean): Promise<boolean> => {
        let disposed = false
        const { connection } = connected(
            guarded([
                async (next) => {
                    if (awaitFirst) await Promise.resolve()
                    watch(() => () => {
                        disposed = true
                    })
                    return next()
                },
            ]),
        )
        await connection.message(SUBSCRIBE)
        await turns()
        if (disposed) return false
        connection.close()
        return disposed
    }
    expect([await disposedWhen(false), await disposedWhen(true)]).toEqual([
        true,
        true,
    ])
})

// 22.10 — A RUNG'S WRITES ON THE MUX ARE REFUSED, not collected onto a scope no answer sends; the jar
// is left as it was. THE REVERT: drop the `applied` the connection's scope is opened with; the write
// is kept silently and `refused` stays undefined.
test('a cookie or response write in a rung on the mux throws, and leaves the jar as it was — 22.10', async () => {
    let refused: string | undefined
    let unwritten: string | undefined
    let after: string | null | undefined
    const { connection, sent } = connected(
        guarded([
            async (next) => {
                try {
                    requestCookies().set('seen', 'yes')
                } catch (error) {
                    refused = (error as Error).message
                }
                after = requestCookies().get('seen')
                try {
                    response().status = 201
                } catch (error) {
                    unwritten = (error as Error).message
                }
                return next()
            },
        ]),
    )
    await connection.message(SUBSCRIBE)
    await turns()
    expect(refused).toContain('RULEBOOK 22.10')
    expect(unwritten).toContain('RULEBOOK 22.10')
    expect(after).toBeNull()
    expect(sent.map((frame) => frame.op)).toEqual(['value'])
    connection.close()
})

// 18.8 — A FOLLOW WHOSE RUNG IS STILL PENDING WHEN THE CONNECTION CLOSES, or when its `unsub` lands,
// is never installed: the rung resolving afterwards finds its placeholder gone. THE REVERT: drop the
// `subscriptions.get(id) !== pending` return in `answerFrame`; each connection is left holding one
// live follow, and the sizes read [1, 1].
test('a follow whose rung resolves after the close or the unsub is not installed — 18.8', async () => {
    const released: (() => void)[] = []
    const mux = guarded([
        async (next) => {
            await new Promise<void>((done) => released.push(done))
            return next()
        },
    ])
    const closed = connected(mux)
    const closing = closed.connection.message(SUBSCRIBE)
    closed.connection.close()
    const unsubbed = connected(mux)
    const unsubbing = unsubbed.connection.message(SUBSCRIBE)
    await unsubbed.connection.message(
        JSON.stringify({ op: 'unsub', id: 1, address: ADDRESS }),
    )
    for (const release of released) release()
    await closing
    await unsubbing
    await turns()
    expect([
        closed.connection.subscriptions.size,
        unsubbed.connection.subscriptions.size,
    ]).toEqual([0, 0])
    expect([...closed.sent, ...unsubbed.sent]).toEqual([])
    unsubbed.connection.close()
})

// 42.12 — THE MUX A COMMAND OPENS ANSWERS AS THE APP ITS REQUESTS DO: one `AnsweringApp`, and one
// `McpSurface`, per app, whether `listen` opens the mux or `abide dev`'s worker does. THE REVERT:
// have `openMux` hand the `Mux` a fresh `{ answer: fetch, mcp: new McpSurface(…) }`, as the worker
// once built for itself; the mux's app is a second record and the two surfaces differ.
test('the mux an app opens carries the app its requests answer as — 42.12', async () => {
    await using app = (await inMemoryApp({})) as BootedApp
    const mux = app.openMux()
    const scoped = await app.run(() => currentRequestScope()?.app)
    expect(scoped).toBeDefined()
    expect(mux.app).toBe(scoped)
})
