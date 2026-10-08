// 18.31, 18.32, 18.33 — A FRAME ON THE MUX IS ANSWERED IN ITS CONNECTION'S SCOPE, made from the upgrade
// request: a socket rung reads `request()` as an http rung does, and a client that hangs up while a
// rung is pending is an `aborted` answer rather than a fault (16.67).

import { expect, test } from 'bun:test'
import { Mux } from '#server/answerSocket.ts'
import { request, requestCookies, response } from '#server/requestScope.ts'
import { reactive, watch } from '#shared'
import { socket } from '#shared/socket.ts'

function connected(
    room: unknown,
    headers: Record<string, string> = {},
): {
    connection: ReturnType<Mux['connect']>
    sent: { op: string; id?: number; error?: { status: number } }[]
} {
    const sent: { op: string; id?: number; error?: { status: number } }[] = []
    const mux = new Mux(
        new Map([['/room', room]]) as never,
        new Map(),
        undefined,
    )
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

// THE REVERT: answer the frame outside the scope (`message` calling the frame's body directly);
// `request()` throws 22.1's error in the rung, `seen` stays undefined and the frame is a 500.
test('a socket rung reads the upgrade request through request() — 18.31, 22.1', async () => {
    let seen: string | null | undefined
    const gated = socket(
        reactive<string>(undefined, { global: true }) as never,
        {
            middleware: [
                async (next) => {
                    seen = request().headers.get('x-reader')
                    return next()
                },
            ],
        },
    )
    const { connection, sent } = connected(gated, { 'x-reader': 'ada' })
    await connection.message(
        JSON.stringify({ op: 'sub', id: 1, address: '/room' }),
    )
    expect(seen).toBe('ada')
    expect(sent.filter((frame) => frame.op === 'error')).toEqual([])
    connection.close()
})

// THE REVERT: leave the upgrade's signal standing at the close; the throw the rung makes after the
// hang-up is reported as unexpected and answered 500.
test('a rung that throws after its connection closed answers aborted — 18.33, 16.67', async () => {
    let release: () => void = () => {}
    const gated = socket(
        reactive<string>(undefined, { global: true }) as never,
        {
            middleware: [
                async () => {
                    await new Promise<void>((done) => {
                        release = done
                    })
                    throw new Error('the upstream went away with the client')
                },
            ],
        },
    )
    const { connection, sent } = connected(gated)
    const answering = connection.message(
        JSON.stringify({ op: 'sub', id: 1, address: '/room' }),
    )
    connection.close()
    release()
    await answering
    expect(sent).toEqual([
        { op: 'error', id: 1, error: expect.objectContaining({ status: 499 }) },
    ])
})

// 12.5 — a watch a rung opened is the connection's, and stops when it closes. THE REVERT: leave the
// scope unreleased at the close; the disposer never runs and `disposed` stays false.
test('a watch a socket rung opened is disposed when its connection closes — 18.32, 12.5', async () => {
    let disposed = false
    const gated = socket(
        reactive<string>(undefined, { global: true }) as never,
        {
            middleware: [
                async (next) => {
                    watch(() => () => {
                        disposed = true
                    })
                    return next()
                },
            ],
        },
    )
    const { connection } = connected(gated)
    await connection.message(
        JSON.stringify({ op: 'sub', id: 1, address: '/room' }),
    )
    expect(disposed).toBe(false)
    connection.close()
    expect(disposed).toBe(true)
})

// 22.10 — A SOCKET RUNG'S WRITES ARE REFUSED, not collected onto a scope no answer sends; the jar is
// left as it was, and a caller asked for there is the connection's own. THE REVERT: drop the
// `applied` the connection's scope is opened with; the write is kept silently and `refused` stays
// undefined.
test('a cookie or response write in a socket rung throws, and leaves the jar as it was — 22.10', async () => {
    let refused: string | undefined
    let unwritten: string | undefined
    let after: string | null | undefined
    const gated = socket(
        reactive<string>(undefined, { global: true }) as never,
        {
            middleware: [
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
            ],
        },
    )
    const { connection, sent } = connected(gated)
    await connection.message(
        JSON.stringify({ op: 'sub', id: 1, address: '/room' }),
    )
    expect(refused).toContain('RULEBOOK 22.10')
    expect(unwritten).toContain('RULEBOOK 22.10')
    expect(after).toBeNull()
    expect(sent.filter((frame) => frame.op === 'error')).toEqual([])
    connection.close()
})
