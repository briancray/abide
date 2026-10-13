// 37.1, 37.7, 18.26 — A HOOK IS FILED AT THE ROUTE OF THE SERVER BLOCK THAT CALLED IT. Process-wide
// hooks compose in route order rather than replacing one another, and a route's middleware holds a
// `GET` followed over the mux as it holds the same `GET` over http.

import { expect, test } from 'bun:test'
import { Mux } from '#server/answerSocket.ts'
import { config } from '#server/config.ts'
import { fileRoute, middleware, onConfig, rungsOver } from '#server/hooks.ts'
import { installServer } from '#server/installServer.ts'
import { reactive } from '#shared'
import { GET } from '#shared/rpc.ts'

installServer()

async function turns(): Promise<void> {
    for (let turn = 0; turn < 10; turn++) await Promise.resolve()
}

// 27.6, 37.7 — EVERY `onConfig` COMPOSES: defaults merged, the deeper route's over the root's, each
// schema run over the whole document. THE REVERT: keep the last `onConfig` filed alone in `resolve`;
// `PORTS` and `REGION` are lost and `LABEL` reads the root's.
test('every onConfig composes, the deeper route over the root — 27.6, 37.7', async () => {
    fileRoute('/billing')
    const billing = onConfig(() => ({ LABEL: 'billing', REGION: 'eu' }), {
        schema: (document: unknown) => ({
            ...(document as object),
            REGION: String(
                (document as { REGION: string }).REGION,
            ).toUpperCase(),
        }),
    })
    fileRoute(undefined)
    const root = onConfig(() => ({ LABEL: 'root', PORTS: 2 }))
    try {
        await config
        const resolved = config()
        expect({
            label: resolved.LABEL,
            region: resolved.REGION,
            ports: resolved.PORTS,
        }).toEqual({ label: 'billing', region: 'EU', ports: 2 })
    } finally {
        billing()
        root()
    }
})

// 18.26 — A FOLLOW IS HELD TO ITS ROUTE'S MIDDLEWARE as it opens: refused there, it is sent its
// triggers alone and never the value. THE REVERT: drop the `routeAdmits` admission from the mux's
// subscribe; the locked follow is fed `value`.
test("a GET followed over the mux passes its route's middleware — 18.26", async () => {
    fileRoute('/vault')
    const unfile = middleware(async (next, { request }) =>
        request.headers.get('x-key') === 'open'
            ? next()
            : new Response('locked', { status: 401 }),
    )
    fileRoute(undefined)
    const handler = GET(reactive('gold', { global: true })) as unknown as {
        address: string
    }
    handler.address = '/vault/gold'
    const mux = new Mux(
        new Map([
            [
                'GET /vault/gold',
                {
                    handler,
                    ui: true,
                    route: '/vault',
                    rungs: rungsOver('/vault'),
                    address: '/vault/gold',
                } as never,
            ],
        ]),
        undefined,
    )
    const fed = async (key: string): Promise<string[]> => {
        const sent: { op: string }[] = []
        const connection = mux.connect(
            new Request('http://app.test/__abide/socket', {
                headers: { 'x-key': key },
            }),
            {
                send(text: string) {
                    sent.push(JSON.parse(text))
                },
                close() {},
            },
        )
        await connection.message(
            JSON.stringify({ op: 'sub', id: 1, address: '/vault/gold' }),
        )
        await turns()
        connection.close()
        return sent.map((frame) => frame.op)
    }
    try {
        expect(await fed('shut')).toEqual([])
        expect(await fed('open')).toEqual(['value'])
    } finally {
        unfile()
    }
})

// 18.26 — ADMITTED BY REACHING THE HANDLER, not by the identity of what came back: a rung that re-heads
// the answer `next` gave still let the follow through. THE REVERT: admit only where the composed
// answer is the very `Response` the innermost step returned; the re-headed follow is fed nothing.
test('a route rung that re-heads the answer still admits the follow — 18.26', async () => {
    fileRoute('/traced')
    const unfile = middleware(async (next) => {
        const answer = await next()
        return new Response(answer.body, answer)
    })
    fileRoute(undefined)
    const handler = GET(reactive('trail', { global: true })) as unknown as {
        address: string
    }
    handler.address = '/traced/trail'
    const mux = new Mux(
        new Map([
            [
                'GET /traced/trail',
                {
                    handler,
                    ui: true,
                    route: '/traced',
                    rungs: rungsOver('/traced'),
                    address: '/traced/trail',
                } as never,
            ],
        ]),
        undefined,
    )
    const sent: { op: string }[] = []
    const connection = mux.connect(
        new Request('http://app.test/__abide/socket'),
        {
            send(text: string) {
                sent.push(JSON.parse(text))
            },
            close() {},
        },
    )
    try {
        await connection.message(
            JSON.stringify({ op: 'sub', id: 1, address: '/traced/trail' }),
        )
        await turns()
        expect(sent.map((frame) => frame.op)).toEqual(['value'])
    } finally {
        connection.close()
        unfile()
    }
})
