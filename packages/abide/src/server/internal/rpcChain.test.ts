// AN RPC'S MIDDLEWARE RUNS PER READ, FROM EVERY DOOR.
//
// `middleware` is `(next) => Response` — tracing, rate limiting, request-context population, auth. It is
// part of what a READ means, not of what HTTP means, so a read that skips it is not merely unauthorized,
// it is unobserved. `makeRpc` builds only handler + memo + deadline, so before this the chain existed on
// exactly one path: the router. An in-process read — page SSR, a handler calling a sibling rpc, an
// `onStart` warmer — ran the handler with no chain at all.
//
// What these tests pin is the arithmetic, because every failure mode here is a COUNT: the chain running
// zero times (the gap), twice (the router composing it AND the callable), or once per read where it should
// be once per request (a rate limiter counting nine hits for a page with eight reads).

import { describe, expect, test } from 'bun:test'
import { HttpError } from '../../shared/HttpError.ts'
import { createTestApp } from '../../test/createTestApp.ts'
import { error } from '../error.ts'
import { GET } from '../GET.ts'
import { POST } from '../POST.ts'
import type { Middleware } from './middleware.ts'

// A middleware that counts and passes through. `next()` returns the inner layer's Response, which for an
// in-process read is the chain's pass token — returned verbatim, so the read's value survives.
function counter(): { hits: number; middleware: Middleware } {
    const box = { hits: 0, middleware: (() => {}) as unknown as Middleware }
    box.middleware = (next) => {
        box.hits++
        return next()
    }
    return box
}

describe("an in-process read runs the rpc's own middleware", () => {
    test('once per read, and the handler still runs', async () => {
        const own = counter()
        const read = GET(() => ({ ok: true }), { middleware: [own.middleware] })
        const app = await createTestApp({ routes: { read } })
        try {
            expect(await read({})).toEqual({ ok: true })
            expect(own.hits).toBe(1)
            // A SECOND read is a second chain run even though the memo may serve a retained value: the chain
            // wraps the CALL, not the memo body. That is not an incidental placement — a memo coalesces by
            // ARGS, so a chain inside the body would let the first caller's authorization stand in for the
            // next caller's.
            await read({})
            expect(own.hits).toBe(2)
        } finally {
            await app.stop()
        }
    })

    test('a short-circuiting middleware reaches the caller as the HttpError it threw', async () => {
        const read = GET(() => ({ secret: true }), {
            middleware: [
                () => {
                    error(403, 'nope')
                },
            ],
        })
        const app = await createTestApp({ routes: { read } })
        try {
            // `error()` THROWS, and a memo's failure channel is a throw, so this arrives unchanged — the same
            // class a browser caller catches after the proxy decodes the 403.
            await expect(read({})).rejects.toThrow(HttpError)
            await expect(read({})).rejects.toThrow('nope')
        } finally {
            await app.stop()
        }
    })

    test('a middleware that RETURNS a response short-circuits too, decoded into an HttpError', async () => {
        let handlerRuns = 0
        const read = GET(
            () => {
                handlerRuns++
                return { secret: true }
            },
            // Returning a Response instead of calling `next()` is the other short-circuit spelling. It has
            // to reach a value caller as a throw, or the read would resolve to a `Response` object as its
            // VALUE — which is precisely the bug that made `error()` throw in the first place.
            {
                middleware: [
                    () => new Response('{"status":401,"message":"denied"}', { status: 401 }),
                ],
            },
        )
        const app = await createTestApp({ routes: { read } })
        try {
            await expect(read({})).rejects.toThrow('denied')
            expect(handlerRuns).toBe(0)
        } finally {
            await app.stop()
        }
    })

    test('a mutation runs it too, including one that opted out of the memo', async () => {
        const own = counter()
        // `memo: false` opts out of coalescing and retention — not out of being observed or authorized,
        // the same reason it does not opt out of the run deadline.
        const write = POST(() => ({ ok: true }), { middleware: [own.middleware], memo: false })
        const app = await createTestApp({ routes: { write } })
        try {
            await write({})
            await write({})
            expect(own.hits).toBe(2)
        } finally {
            await app.stop()
        }
    })
})

describe('the chain runs exactly ONCE per HTTP read', () => {
    // The router composes `[...global, ...own]` around the whole of dispatch. The callable now has a chain
    // too, so the router invokes `route.bare(args)` — the same producer minus the chain. If it ever went
    // back through the chained callable, every HTTP read would run its middleware twice and this is the
    // only thing that would say so.
    test('not twice — the router uses the un-chained entry', async () => {
        const global = counter()
        const own = counter()
        const read = GET(() => ({ ok: true }), { middleware: [own.middleware] })
        const app = await createTestApp({ routes: { read }, middleware: [global.middleware] })
        try {
            const response = await app.fetch('/__abide/rpc/read?__abide_args=%7B%7D')
            expect(response.status).toBe(200)
            await response.json()
            expect(own.hits).toBe(1)
            expect(global.hits).toBe(1)
        } finally {
            await app.stop()
        }
    })
})

describe('the GLOBAL chain is per REQUEST, not per read', () => {
    // The fork this design had to pick. The rpc's own middleware is part of the read; the global chain is
    // the app's request onion and has already run by the time a page renders. Re-running it per read would
    // make a page with eight reads count NINE hits in a rate limiter and log nine lines for one request.
    test('an in-process read inside a request does NOT re-run the global chain', async () => {
        const global = counter()
        const own = counter()
        const inner = GET(() => ({ n: 1 }), { middleware: [own.middleware] })
        // An outer rpc reading a sibling in-process is the cheapest stand-in for page SSR: both run inside a
        // request whose global chain has already run.
        const outer = GET(async () => ({ inner: await inner({}) }))
        const app = await createTestApp({
            routes: { inner, outer },
            middleware: [global.middleware],
        })
        try {
            const response = await app.fetch('/__abide/rpc/outer?__abide_args=%7B%7D')
            expect(await response.json()).toEqual({ inner: { n: 1 } })
            // ONE global run for the one request, even though two rpcs were involved.
            expect(global.hits).toBe(1)
            // …and the inner rpc's OWN middleware did run, which is the whole point of the change.
            expect(own.hits).toBe(1)
        } finally {
            await app.stop()
        }
    })

    test('a read from OUTSIDE any request runs both rungs', async () => {
        const global = counter()
        const own = counter()
        const read = GET(() => ({ ok: true }), { middleware: [own.middleware] })
        const app = await createTestApp({ routes: { read }, middleware: [global.middleware] })
        try {
            // No request scope — a cron tick, or anything else reading outside a request in a BUILT app.
            // Nothing has run the global chain for this unit of work, so the read owes it.
            //
            // Deliberately not named here: `abide run`. This boots through `createTestApp`, which calls
            // `createApp` and therefore binds the chain; `abide run` does not call `createApp` at all, so a
            // migration's read is unchained and this test would not catch it. `rpcChain.ts`'s header records
            // that gap; asserting it needs a `run`-shaped harness, not a scope-free call inside a test app.
            await read({})
            expect(global.hits).toBe(1)
            expect(own.hits).toBe(1)
        } finally {
            await app.stop()
        }
    })
})

describe('an rpc with no middleware at all', () => {
    test('is left unwrapped — no chain, no scope probe per call', async () => {
        let runs = 0
        const read = GET(() => {
            runs++
            return { ok: true }
        })
        // No global middleware and no per-rpc middleware, so `createApp` installs no runner at all. Asserted
        // because it is the common case and it is on the hot path: the alternative pays a closure and a
        // `currentScope()` read per read to compose an empty list.
        const app = await createTestApp({ routes: { read } })
        try {
            expect(await read({})).toEqual({ ok: true })
            expect(runs).toBe(1)
        } finally {
            await app.stop()
        }
    })
})
