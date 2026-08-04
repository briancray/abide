// `fn.raw` IS THE BARE CALL, ENCODED — one difference from `fn(args)`, and it is the return type.
//
// `.raw` used to call the HANDLER: no middleware chain, no memo, no run deadline. So it was the one read
// surface that was neither authorized nor observed nor bounded, and `auth.md` carried an exception for it.
// Wanting the RESPONSE says nothing about wanting to skip the read's own contract, so it now runs the same
// call every other door runs and encodes the result the way the wire would.
//
// EVERY TEST HERE COUNTS WORK RATHER THAN CHECKING THE BODY, because each failure mode returns the right
// bytes: an unauthorized `.raw` still answers 200 with the handler's value, an uncoalesced one still
// answers the same JSON, and a `.raw` that re-runs the handler is only visible as a second run.

import { describe, expect, test } from 'bun:test'
import { createTestApp } from '../test/createTestApp.ts'
import { error } from './error.ts'
import { GET } from './GET.ts'
import { POST } from './POST.ts'
import { sse } from './sse.ts'

describe('.raw runs the rpc middleware chain', () => {
    test('the chain runs once per .raw, exactly as it does for the bare call', async () => {
        let hits = 0
        const read = GET(() => ({ ok: true }), {
            middleware: [
                (next) => {
                    hits++
                    return next()
                },
            ],
        })
        const app = await createTestApp({ routes: { read } })
        try {
            const response = await read.raw({})
            expect(response.status).toBe(200)
            expect(await response.json()).toEqual({ ok: true })
            expect(hits).toBe(1)
        } finally {
            await app.stop()
        }
    })

    // THE HOLE THIS CLOSES. A guard that answers 403 for a browser caller used to be silently absent on
    // `.raw`, which handed back the value at 200 — the handler ran and the middleware never did.
    test('a short-circuiting middleware renders as the Response, and the handler never runs', async () => {
        let handlerRuns = 0
        const read = GET(
            () => {
                handlerRuns++
                return { secret: true }
            },
            {
                middleware: [
                    () => {
                        error(403, 'nope')
                    },
                ],
            },
        )
        const app = await createTestApp({ routes: { read } })
        try {
            const response = await read.raw({})
            expect(response.status).toBe(403)
            expect(await response.json()).toMatchObject({ status: 403, message: 'nope' })
            expect(handlerRuns).toBe(0)
        } finally {
            await app.stop()
        }
    })
})

describe('.raw shares the memo with the bare call', () => {
    test('a read fills ONE slot however it was asked for', async () => {
        let runs = 0
        const read = GET(({ id }: { id: number }) => {
            runs++
            return { id }
        })
        const app = await createTestApp({ routes: { read } })
        try {
            expect(await read({ id: 1 })).toEqual({ id: 1 })
            // Retained (a read's ttl is ∞), so `.raw` on the same args is served from the same slot.
            expect(await (await read.raw({ id: 1 })).json()).toEqual({ id: 1 })
            expect(runs).toBe(1)
            // …and the slot `.raw` filled is the one the reactive surface reports on, which is the other
            // half of "the same call": a `.raw` that had its own cache would leave `live()` cold.
            await read.raw({ id: 2 })
            expect(read.live({ id: 2 })).toEqual({ id: 2 })
            expect(runs).toBe(2)
            // An invalidate reaches it like any other read — cold again.
            read.invalidate({ id: 1 })
            await read.raw({ id: 1 })
            expect(runs).toBe(3)
        } finally {
            await app.stop()
        }
    })

    test('a memo: false mutation still runs every call — the bare call bypasses, so .raw does too', async () => {
        let runs = 0
        const write = POST(
            () => {
                runs++
                return { ok: true }
            },
            { memo: false },
        )
        const app = await createTestApp({ routes: { write } })
        try {
            await write.raw({})
            await write.raw({})
            expect(runs).toBe(2)
        } finally {
            await app.stop()
        }
    })
})

describe('.raw encodes what the wire would answer', () => {
    test('a streaming read is encoded as jsonl, and REPLAYS rather than consuming the source once', async () => {
        let runs = 0
        const ticker = GET(
            async function* (_args: Record<string, never>) {
                runs++
                yield 1
                yield 2
            },
            { memo: { crossRequest: true, ttl: 10_000 } },
        )
        const app = await createTestApp({ routes: { ticker } })
        try {
            const first = await ticker.raw({})
            expect(first.headers.get('content-type')).toContain('jsonl')
            expect((await first.text()).trim().split('\n')).toEqual(['1', '2'])
            // The handler's single-consumption body is gone: `.raw` hands each caller its own
            // replay-then-live cursor over ONE run, which is what the memo already gives every other door.
            const second = await ticker.raw({})
            expect((await second.text()).trim().split('\n')).toEqual(['1', '2'])
            expect(runs).toBe(1)
        } finally {
            await app.stop()
        }
    })

    test("init.headers Accept selects sse, and a handler's own sse() choice still wins over it", async () => {
        const bare = GET(async function* (_args: Record<string, never>) {
            yield 'a'
        })
        const tagged = GET(() =>
            sse(
                (async function* () {
                    yield 'b'
                })(),
            ),
        )
        const app = await createTestApp({ routes: { bare, tagged } })
        try {
            const negotiated = await bare.raw({}, { headers: { accept: 'text/event-stream' } })
            expect(negotiated.headers.get('content-type')).toContain('text/event-stream')
            await negotiated.text()
            // The handler declared sse; an Accept asking for anything else does not override it.
            const declared = await tagged.raw(undefined as never, {
                headers: { accept: 'application/json' },
            })
            expect(declared.headers.get('content-type')).toContain('text/event-stream')
            await declared.text()
        } finally {
            await app.stop()
        }
    })

    // An UNTAGGED Response is the memo's value (nothing to see through), so it passes through whole —
    // status and headers intact. This is the escape hatch for a handler that really is shaping bytes.
    test('a Response the handler returned passes through untouched', async () => {
        const download = GET(
            () =>
                new Response('col-a,col-b', {
                    status: 201,
                    headers: { 'content-type': 'text/csv', 'x-marker': 'kept' },
                }),
        )
        const app = await createTestApp({ routes: { download } })
        try {
            const response = await download.raw(undefined as never)
            expect(response.status).toBe(201)
            expect(response.headers.get('content-type')).toBe('text/csv')
            expect(response.headers.get('x-marker')).toBe('kept')
            expect(await response.text()).toBe('col-a,col-b')
        } finally {
            await app.stop()
        }
    })

    // …and it survives being asked for TWICE, which is what going through the memo made possible to get
    // wrong. A `Response` body is single-consumption while the slot retaining it is not (a read's ttl is
    // ∞), so handing the retained object itself to each caller gives the second one `Body already used` —
    // for a door whose whole job is to hand back a readable Response. Calling the handler per `.raw`, as
    // this used to, produced a fresh Response every time and hid the question.
    test('…and it is still readable on the SECOND .raw, from the same retained slot', async () => {
        let runs = 0
        const download = GET(() => {
            runs++
            return new Response('col-a,col-b', { status: 201 })
        })
        const app = await createTestApp({ routes: { download } })
        try {
            expect(await (await download.raw(undefined as never)).text()).toBe('col-a,col-b')
            expect(await (await download.raw(undefined as never)).text()).toBe('col-a,col-b')
            expect(runs).toBe(1)
        } finally {
            await app.stop()
        }
    })

    // ADR 0028 D6 claimed `.raw` was bounded by the run deadline and this side never armed one — the
    // handler was awaited bare. Going through the memo is what makes the claim true, and a trip is
    // answered with the same 504 a browser `.raw` receives for it rather than escaping as a DOMException.
    test('a tripped run deadline is a 504, not an unhandled throw', async () => {
        const slow = GET(
            async () => {
                await Bun.sleep(2_000)
                return { late: true }
            },
            { timeout: 20 },
        )
        const app = await createTestApp({ routes: { slow } })
        try {
            const response = await slow.raw(undefined as never)
            expect(response.status).toBe(504)
            expect(await response.json()).toMatchObject({ name: 'TimeoutError' })
        } finally {
            await app.stop()
        }
    })
})
