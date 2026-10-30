// 41.20, 41.21, 41.25 — THE EARLY-CALL SCRIPT AS A BROWSER RUNS IT, read back through `answerOf`.
// The runner is a string no typecheck reaches, so its record and the one classifier that reads it
// are held together here: every kind of answer a page can start, each read as a fetched one is.

import { expect, test } from 'bun:test'

import { EARLY_CALL_RUNNER } from '#server/render.ts'
import { type Answer, answered, answerOf } from '#shared/answerOf.ts'
import { EARLY_CALLS } from '#shared/EARLY_CALLS.ts'
import { answerChunks } from '#shared/framing.ts'
import { rpcRequest } from '#shared/rpcRequest.ts'
import { paintedCallsLanded } from '#shared/takeEarlyCall.ts'

const ANSWERS: Record<string, () => Response> = {
    '/rpc/invoice': () =>
        new Response('{"id":"7"}', {
            headers: {
                'content-type': 'application/json',
                etag: 'W/"12"',
                'cache-control': 'max-age=30',
            },
        }),
    '/rpc/cover': () =>
        new Response(new Uint8Array([37, 80, 0, 255]), {
            headers: { 'content-type': 'image/png' },
        }),
    '/rpc/missing': () =>
        new Response('Bad Gateway', {
            status: 502,
            statusText: 'Bad Gateway',
            headers: { 'content-type': 'text/plain' },
        }),
    '/rpc/lines': () =>
        new Response('{"n":1}\n{"n":2}\n', {
            headers: { 'content-type': 'application/jsonl' },
        }),
}

/** Runs the runner over `rows` as the head's JSON block hands them, against `answering`. */
function runEarlyCalls(
    rows: unknown[][],
    answering: (url: string, init: RequestInit) => Promise<Response>,
    self: object = globalThis,
): void {
    new Function('self', 'fetch', 'document', EARLY_CALL_RUNNER)(
        self,
        answering,
        {
            currentScript: {
                previousElementSibling: { textContent: JSON.stringify(rows) },
            },
        },
    )
}

function rowOf(address: string, painted: boolean): unknown[] {
    const request = rpcRequest('GET', address, undefined)
    return painted
        ? [request.key, request.url, request.init, 1]
        : [request.key, request.url, request.init]
}

// THE REVERT: drop the runner's painted arm (`h?r.arrayBuffer()…:`), recording every response
// unread; no painted answer is settled at once, and this reads `settled at once: 0` where 3 are due.
test("a call painted settled is read from the runner's record at once, as a fetched one is — 41.25, 41.27", async () => {
    const globals = globalThis as unknown as Record<string, unknown>
    try {
        runEarlyCalls(
            [
                rowOf('/rpc/invoice', true),
                rowOf('/rpc/cover', true),
                rowOf('/rpc/missing', true),
            ],
            async (url) => (ANSWERS[url] as () => Response)(),
        )
        await paintedCallsLanded()
        const answers: (Answer | Promise<Answer>)[] = []
        for (const address of ['/rpc/invoice', '/rpc/cover', '/rpc/missing'])
            answers.push(
                answerOf(
                    rpcRequest('GET', address, undefined),
                    false,
                    undefined,
                ),
            )
        let settled = 0
        for (const answer of answers)
            if (!(answer instanceof Promise)) settled += 1
        expect(`settled at once: ${settled}`).toBe('settled at once: 3')
        const [invoice, cover, missing] = (await Promise.all(answers)) as [
            Answer,
            Answer,
            Answer,
        ]
        expect(answered(invoice)).toEqual({ id: '7' })
        expect(invoice.version).toBe(12)
        expect(invoice.life).toBe(30_000)
        expect(invoice.followable).toBe(true)
        expect([...(answered(cover) as Uint8Array)]).toEqual([37, 80, 0, 255])
        expect(cover.followable).toBe(false)
        expect((answered(missing) as { status: number }).status).toBe(502)
        expect(missing.followable).toBe(false)
    } finally {
        globals[EARLY_CALLS] = undefined
    }
})

// 16.32 — A CALL PAINTED IN FLIGHT IS LEFT UNREAD, so a streaming copy takes its lines as they land
// and any other copy reads it to its end; and one whose request failed is made again.
test('a call painted in flight is read as its reader reads it, and a failed one is fetched again — 16.32, 41.21', async () => {
    const globals = globalThis as unknown as Record<string, unknown>
    const previous = globalThis.fetch
    const fetched: string[] = []
    globalThis.fetch = (async (url: string) => {
        fetched.push(url)
        return (ANSWERS['/rpc/invoice'] as () => Response)()
    }) as typeof fetch
    try {
        runEarlyCalls(
            [
                rowOf('/rpc/lines', false),
                rowOf('/rpc/invoice', false),
                rowOf('/rpc/missing', false),
            ],
            async (url) => {
                if (url === '/rpc/missing') throw new TypeError('offline')
                return (ANSWERS[url] as () => Response)()
            },
        )
        const lines = await answerOf(
            rpcRequest('GET', '/rpc/lines', undefined),
            true,
            undefined,
        )
        expect(lines.body).toBeInstanceOf(ReadableStream)
        const chunks: unknown[] = []
        for await (const chunk of answerChunks(
            lines.body as ReadableStream<Uint8Array>,
            lines.framing,
        ))
            chunks.push(chunk)
        expect(chunks).toEqual([{ n: 1 }, { n: 2 }])
        expect(
            answered(
                await answerOf(
                    rpcRequest('GET', '/rpc/invoice', undefined),
                    false,
                    undefined,
                ),
            ),
        ).toEqual({ id: '7' })
        expect(fetched).toEqual([])
        expect(
            answered(
                await answerOf(
                    rpcRequest('GET', '/rpc/missing', undefined),
                    false,
                    undefined,
                ),
            ),
        ).toEqual({ id: '7' })
        expect(fetched).toEqual(['/rpc/missing'])
    } finally {
        globalThis.fetch = previous
        globals[EARLY_CALLS] = undefined
    }
})

// 16.80 — A PAGE THE WORKER ANSWERS HAS IT ANSWER THE PAGE'S CALLS TOO, which only the browser can
// tell: a page the worker replays from its copy was rendered once, for whichever fetch kept it.
// THE REVERT: drop the runner's `if(w)n.cache='force-cache'`; the controlled page reads `no-cache`.
test('an early call is started force-cache where a worker answers the page, and no-cache where none does — 16.80', async () => {
    const said: string[] = []
    for (const [name, serviceWorker] of [
        ['worker', { controller: {} }],
        ['none', undefined],
    ] as const) {
        const self: Record<string, unknown> = { navigator: { serviceWorker } }
        runEarlyCalls(
            [rowOf('/rpc/invoice', false)],
            async (url, init) => {
                said.push(`${name}: ${init.cache}`)
                return (ANSWERS[url] as () => Response)()
            },
            self,
        )
    }
    expect(said).toEqual(['worker: force-cache', 'none: no-cache'])
})
