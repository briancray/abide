import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { HttpError } from '../src/lib/shared/HttpError.ts'
import type { OutboxEntry } from '../src/lib/shared/types/OutboxEntry.ts'
import { remoteProxy } from '../src/lib/ui/remoteProxy.ts'
import { outboxRegistry } from '../src/lib/ui/rpcOutbox/outboxRegistry.ts'
import { memoryStore } from './support/memoryStore.ts'

const realFetch = globalThis.fetch

describe('durable remote proxy', () => {
    beforeEach(() => {
        ;(globalThis as { window?: unknown }).window = { location: { href: 'http://localhost/' } }
    })
    afterEach(() => {
        globalThis.fetch = realFetch
        delete (globalThis as { window?: unknown }).window
        outboxRegistry.reset() // app-scoped queues outlive a mount; clear between tests
    })

    test('an unreachable status (503) parks the request and throws a queued HttpError', async () => {
        globalThis.fetch = (async () =>
            new Response('down', { status: 503 })) as unknown as typeof fetch
        const save = remoteProxy<{ text: string }, void>('POST', '/rpc/durable503', {
            outbox: true, // park on unreachable, drain via retry()
            store: memoryStore(),
        })
        const err = await save({ text: 'hi' }).catch((e) => e)
        expect(err).toBeInstanceOf(HttpError)
        expect(err.kind).toBe('queued') // the "parked, will retry" discriminator
        expect(err.status).toBe(503)
        expect(save.outbox!().map((e) => e.args.text)).toEqual(['hi']) // parked as a side-effect
        const entry = save.outbox!()[0]!
        expect((err.data as OutboxEntry<{ text: string }>).id).toBe(entry.id) // .data is this entry
        expect((entry.error as HttpError).status).toBe(503) // the entry carries the raw cause
        entry.controller.abort()
        expect(save.outbox!()).toHaveLength(0) // cancel removes it
    })

    test('a parked write keeps a re-readable body after the fetch consumed the original', async () => {
        /* The real `fetch` reads (and locks) the request body. The stub mirrors that so
           the test exercises what production does — a `() => new Response()` stub never
           touches the body and would mask a parked-consumed-request regression. */
        globalThis.fetch = (async (request: Request) => {
            await request.text() // consume the body, like a real fetch
            return new Response('down', { status: 503 })
        }) as unknown as typeof fetch
        const save = remoteProxy<{ text: string }, void>('POST', '/rpc/durableBody', {
            outbox: true, // park on unreachable, drain via retry()
            store: memoryStore(),
        })
        await expect(save({ text: 'hi' })).rejects.toThrow()
        const entry = save.outbox!()[0]!
        /* The parked Request must still carry the body for a resend — a consumed original
           would clone to an empty string and reconstruct to a locked stream. */
        expect(await entry.request.clone().text()).toContain('hi')
    })

    test('a transport failure parks and throws a queued HttpError carrying the cause', async () => {
        globalThis.fetch = (async () => {
            throw new TypeError('Failed to fetch')
        }) as unknown as typeof fetch
        const save = remoteProxy<{ text: string }, void>('POST', '/rpc/durableNet', {
            outbox: true, // park on unreachable, drain via retry()
            store: memoryStore(),
        })
        const err = await save({ text: 'hi' }).catch((e) => e)
        expect(err).toBeInstanceOf(HttpError)
        expect(err.kind).toBe('queued')
        const entry = save.outbox!()[0]!
        expect((err.data as OutboxEntry<{ text: string }>).id).toBe(entry.id) // .data is this entry
        expect(entry.error).toBeInstanceOf(TypeError) // the underlying transport cause rides the entry
        expect(save.outbox!()).toHaveLength(1)
    })

    test('a 400 throws but is NOT queued/parked (the server handled it)', async () => {
        globalThis.fetch = (async () =>
            new Response('bad', { status: 400 })) as unknown as typeof fetch
        const save = remoteProxy<{ text: string }, void>('POST', '/rpc/durable400', {
            outbox: true, // park on unreachable, drain via retry()
            store: memoryStore(),
        })
        const err = await save({ text: 'hi' }).catch((e) => e)
        expect(err).toBeInstanceOf(HttpError)
        expect(err.kind).not.toBe('queued') // server handled it — not parked
        expect(save.outbox!()).toHaveLength(0)
    })

    test('a 2xx call succeeds and parks nothing', async () => {
        globalThis.fetch = (async () =>
            new Response(JSON.stringify({ ok: true }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            })) as unknown as typeof fetch
        const save = remoteProxy<{ text: string }, { ok: boolean }>('POST', '/rpc/durableOk', {
            outbox: true, // park on unreachable, drain via retry()
            store: memoryStore(),
        })
        await expect(save({ text: 'hi' })).resolves.toEqual({ ok: true })
        expect(save.outbox!()).toHaveLength(0)
    })

    test('once a backlog exists, a fresh call parks at the tail instead of fetching (FIFO)', async () => {
        let sent = 0
        let status = 503
        globalThis.fetch = (async () => {
            sent++
            return new Response(status === 200 ? 'ok' : 'down', { status })
        }) as unknown as typeof fetch
        const save = remoteProxy<{ n: number }, void>('POST', '/rpc/durableFifo', {
            outbox: true,
            store: memoryStore(),
        })

        await save({ n: 1 }).catch(() => {}) // 503 → parks; 1 fetch attempted
        expect(sent).toBe(1)

        status = 200 // server "recovers" — but a backlog already exists
        const err = await save({ n: 2 }).catch((e) => e)
        expect(err).toBeInstanceOf(HttpError)
        expect(err.kind).toBe('queued') // parked behind the backlog, did NOT leapfrog
        expect(sent).toBe(1) // no live fetch — the call never hit the network
        expect(save.outbox!().map((e) => e.args.n)).toEqual([1, 2]) // tail order preserved

        await save.outbox!.retry() // awaitable — resolves once the FIFO replay settles
        expect(save.outbox!()).toHaveLength(0)
        expect(sent).toBe(3) // both replayed (entry 1, then entry 2)
    })

    test('entry.settled resolves with the decoded result when the replay is delivered', async () => {
        let status = 503
        globalThis.fetch = (async () =>
            status === 200
                ? new Response(JSON.stringify({ ok: true }), {
                      status: 200,
                      headers: { 'content-type': 'application/json' },
                  })
                : new Response('down', { status: 503 })) as unknown as typeof fetch
        const save = remoteProxy<{ text: string }, { ok: boolean }>('POST', '/rpc/durableSettled', {
            outbox: true,
            store: memoryStore(),
        })
        const err = await save({ text: 'hi' }).catch((e) => e)
        const entry = (err as HttpError).data as OutboxEntry<{ text: string }>
        const settled = entry.settled // reading it arms the deferred
        status = 200 // server recovers
        await save.outbox!.retry()
        expect(await settled).toEqual({ ok: true }) // the result, as if the call had worked initially
    })

    test('entry.settled rejects with the real HttpError when the replay is refused', async () => {
        let status = 503
        globalThis.fetch = (async () => new Response('nope', { status })) as unknown as typeof fetch
        const save = remoteProxy<{ text: string }, void>('POST', '/rpc/durableSettledFail', {
            outbox: true,
            store: memoryStore(),
        })
        const err = await save({ text: 'hi' }).catch((e) => e)
        const entry = (err as HttpError).data as OutboxEntry<{ text: string }>
        const settled = entry.settled
        status = 422 // server now handles + refuses it
        await save.outbox!.retry()
        const refused = (await settled.catch((e) => e)) as HttpError
        expect(refused).toBeInstanceOf(HttpError)
        expect(refused.status).toBe(422)
        expect(save.outbox!()).toHaveLength(0) // a refused replay leaves the queue
    })

    test('entry.settled rejects with AbortError when the parked write is canceled', async () => {
        globalThis.fetch = (async () =>
            new Response('down', { status: 503 })) as unknown as typeof fetch
        const save = remoteProxy<{ text: string }, void>('POST', '/rpc/durableSettledCancel', {
            outbox: true,
            store: memoryStore(),
        })
        const err = await save({ text: 'hi' }).catch((e) => e)
        const entry = (err as HttpError).data as OutboxEntry<{ text: string }>
        const settled = entry.settled
        entry.controller.abort()
        const aborted = (await settled.catch((e) => e)) as DOMException
        expect(aborted).toBeInstanceOf(DOMException)
        expect(aborted.name).toBe('AbortError')
    })

    test('.outbox exposes retry(); a non-durable proxy has no face', () => {
        const durable = remoteProxy<{ text: string }, void>('POST', '/rpc/durableFace', {
            outbox: true, // park on unreachable, drain via retry()
            store: memoryStore(),
        })
        expect(typeof durable.outbox).toBe('function')
        expect(typeof durable.outbox!.retry).toBe('function')

        const plain = remoteProxy<{ text: string }, void>('POST', '/rpc/plain')
        expect(plain.outbox).toBeUndefined()
    })

    test('outbox: false leaves a plain proxy', () => {
        const none = remoteProxy<{ text: string }, void>('POST', '/rpc/durableNone', {
            outbox: false,
            store: memoryStore(),
        })
        expect(none.outbox).toBeUndefined()
    })
})
