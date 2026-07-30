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
import { identity } from '../../shared/identity.ts'
import { route } from '../../shared/route.ts'
import { createTestApp } from '../../test/createTestApp.ts'
import { error } from '../error.ts'
import { GET } from '../GET.ts'
import { POST } from '../POST.ts'
import { request } from '../request.ts'
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
    // too, so the router invokes `route.__bare(args)` — the same producer minus the chain. If it ever went
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

    test('a read from OUTSIDE any request runs the OWN rung and NOT the global one', async () => {
        const global = counter()
        const own = counter()
        const read = GET(() => ({ ok: true }), { middleware: [own.middleware] })
        const app = await createTestApp({ routes: { read }, middleware: [global.middleware] })
        try {
            // No request scope — a cron tick, an `abide run` migration, an `onStart` warmer.
            //
            // The own rung runs, because it is part of what the read MEANS. The global rung does NOT, and
            // that is the correction: it is per REQUEST, and there is no request here for it to authorize.
            // It used to run, selected by `currentScope() === undefined` — read as "nothing has run it, so
            // run it" — which is a different question from "should it run here?". The cost was concrete:
            // a global middleware doing `request().headers.get(...)`, which is the ordinary shape, THREW
            // from this door, and because a chain that does not reach its terminal fails closed, the read
            // died inside the middleware whose job was to observe it.
            await read({})
            expect(own.hits).toBe(1)
            expect(global.hits).toBe(0)
        } finally {
            await app.stop()
        }
    })

    // The failure the rule above prevents, asserted directly rather than left to the count: a global
    // middleware that touches the request must not be REACHED from a door that has no request. Written with
    // `request()` because that is what a real one does (auth, tracing, rate limiting all read it).
    test('a global middleware that reads request() is not reached by a scope-free read', async () => {
        const read = GET(() => ({ ok: true }))
        const app = await createTestApp({
            routes: { read },
            middleware: [
                (next) => {
                    // Would throw "no request scope" if this rung ran here — and the throw would surface as
                    // the READ failing, not as a middleware bug, which is what made it hard to place.
                    request()
                    return next()
                },
            ],
        })
        try {
            expect(await read({})).toEqual({ ok: true })
        } finally {
            await app.stop()
        }
    })
})

describe('route() inside the chain names the READ, not the caller', () => {
    // THE FAILURE THIS EXISTS FOR. `auth.md`'s canonical guard is `route().name === '<rpc>'`, and `route()`
    // answers from the active reactive scope — which during page SSR is the NAV's. So the guard saw
    // `kind: 'nav'` and the page's pattern, and silently never fired. Running the middleware with the wrong
    // subject is worse than not running it: it looks like coverage.
    test('an in-process read reports its own rpc name and args, inside a request for a page', async () => {
        let seen: { kind: string; name: string; params: unknown } | undefined
        const inner = GET(({ id }: { id: number }) => ({ id }), {
            middleware: [
                (next) => {
                    const info = route()
                    seen = { kind: info.kind, name: info.name, params: info.params }
                    return next()
                },
            ],
        })
        // The outer rpc stands in for a page render: a request is in flight, its own route info is active,
        // and the inner read must not inherit it.
        const outer = GET(async () => ({ inner: await inner({ id: 7 }) }))
        const app = await createTestApp({ routes: { inner, outer } })
        try {
            await app.fetch('/__abide/rpc/outer?__abide_args=%7B%7D')
            expect(seen).toEqual({ kind: 'rpc', name: 'inner', params: { id: 7 } })
        } finally {
            await app.stop()
        }
    })

    // The other half of the override: it must not COST the caller's scope. `request()`/`cookies()` answer
    // from the request scope, which is resolved by comparing its slots Map to the active reactive scope's BY
    // IDENTITY — so the override shares that Map rather than making a new scope.
    test('the caller request()/identity() still answer inside the overridden scope', async () => {
        // A record rather than two `let`s: assigned only inside a callback, a `let` narrows to its
        // initializer's type at the assertion and the comparison stops type-checking.
        const saw: { header?: string | null; identity?: boolean } = {}
        const inner = GET(() => ({ ok: true }), {
            middleware: [
                (next) => {
                    saw.header = request().headers.get('x-probe')
                    saw.identity = identity() !== undefined
                    return next()
                },
            ],
        })
        const outer = GET(async () => ({ inner: await inner({}) }))
        const app = await createTestApp({ routes: { inner, outer } })
        try {
            await app.fetch('/__abide/rpc/outer?__abide_args=%7B%7D', {
                headers: { 'x-probe': 'carried' },
            })
            expect(saw.header).toBe('carried')
            expect(saw.identity).toBe(true)
        } finally {
            await app.stop()
        }
    })

    // Concurrency is why the override is a SCOPE and not `scope.route = …` restored in a finally. A page
    // firing several reads at once is the documented case, and an assignment would let them clobber each
    // other's subject between the set and the restore. AsyncLocalStorage isolates them; a field does not.
    test('concurrent reads each see their own name', async () => {
        const seen: string[] = []
        const record = (next: () => Response | Promise<Response>): Response | Promise<Response> => {
            seen.push(route().name)
            return next()
        }
        const a = GET(
            async () => {
                await Bun.sleep(5)
                return { a: true }
            },
            { middleware: [record] },
        )
        const b = GET(() => ({ b: true }), { middleware: [record] })
        const outer = GET(async () => {
            await Promise.all([a({}), b({})])
            return { done: true }
        })
        const app = await createTestApp({ routes: { a, b, outer } })
        try {
            await app.fetch('/__abide/rpc/outer?__abide_args=%7B%7D')
            expect(seen.slice().sort()).toEqual(['a', 'b'])
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
