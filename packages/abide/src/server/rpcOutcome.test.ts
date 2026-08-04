// The rpc OUTCOME contract, both halves (rpc-core §4).
//
// `rpc = memo + transport`, so a handler is a memo body and a memo's failure channel is a THROW. These
// guard the two directions that were each half-wrong: `error()` used to RETURN a `Response`, so it
// reached an in-process caller as a resolved VALUE (and a read at `ttl: ∞` then retained the non-2xx as
// that slot's value forever, with `fn.error()` still reporting `undefined`), while a handler that threw
// reached the wire flattened to a bare 500 with its status lost.
//
// The value assertions alone cannot guard this: the poisoned-cache case returned the "right" object —
// a `Response` — and only the WORK and the CHANNEL it landed in were wrong. So these count handler runs
// and assert which channel the failure occupies, not just what a caller sees.

import { describe, expect, test } from 'bun:test'
import { HttpError } from '../shared/HttpError.ts'
import { error } from './error.ts'
import { GET } from './GET.ts'
import { POST } from './POST.ts'
import { redirect } from './redirect.ts'

describe('an rpc failure leaves through the memo error channel', () => {
    test('an in-process read THROWS rather than resolving the Response as a value', async () => {
        const read = GET(({ fail }: { fail: boolean }) =>
            fail ? error(404, 'not here') : { greeting: 'hi' },
        )
        let caught: unknown
        try {
            await read({ fail: true })
        } catch (e) {
            caught = e
        }
        expect(caught).toBeInstanceOf(HttpError)
        expect((caught as HttpError).status).toBe(404)
        // The success branch is untouched — the point is a clean success type, not a poisoned one.
        expect(await read({ fail: false })).toEqual({ greeting: 'hi' })
    })

    test('a mutation throws identically — the surface is symmetric', async () => {
        const write = POST(({ ok }: { ok: boolean }) => {
            if (!ok) error(422, 'rejected')
            return { saved: true }
        })
        expect(write({ ok: false })).rejects.toThrow('rejected')
        expect(await write({ ok: true })).toEqual({ saved: true })
    })

    // THE REGRESSION: a failure must not be retained as the slot's VALUE. It landed there because the
    // handler returned a `Response`, which the memo could only read as a successful result.
    test('a failure is never retained as the slot value, and probes report it as an error', async () => {
        const read = GET(({ id }: { id: number }) => {
            error(503, 'upstream down')
            return { id }
        })
        await expect(read({ id: 1 })).rejects.toThrow('upstream down')
        // `peek` is the non-blocking display read — it must not hand a caller a `Response` dressed as data.
        expect(read.live({ id: 1 })).toBeUndefined()
        // The failure is visible on the axis that means failure.
        expect(read.error({ id: 1 })).toBeInstanceOf(HttpError)
    })

    test('a typed failure narrows through fn.isError on the in-process path', async () => {
        const rateLimited = error.typed('RateLimited', 429)
        const read = GET(() => rateLimited({ retryAfter: 30 }))
        let caught: unknown
        try {
            await read()
        } catch (e) {
            caught = e
        }
        expect(read.isError(caught, 'RateLimited')).toBe(true)
        expect(read.isError(caught, 'Forbidden')).toBe(false)
        expect((caught as HttpError).data).toEqual({ retryAfter: 30 })
    })

    test('.raw renders the outcome instead of throwing, matching the browser proxy', async () => {
        const read = GET(() => error(404, 'not here'))
        const response = await read.raw(undefined as never)
        expect(response.status).toBe(404)
        expect(await response.json()).toMatchObject({ status: 404, message: 'not here' })
    })

    test('a redirect leaves the value channel too', async () => {
        const read = GET(() => redirect('/login', 303))
        await expect(read()).rejects.toThrow('/login')
        expect(read.live(undefined as never)).toBeUndefined()
    })
})
