// `serve` — the async-local caller scope, which is the half of scoping a browser card cannot show.
//
// This is not a demo, and that is deliberate rather than laziness: `serve` is built on
// `AsyncLocalStorage`, and Bun bundles `node:async_hooks` for a browser target as an EMPTY OBJECT.
// A demo case runs the same body headless AND in the card, so a claim that needs ALS is a claim no
// card can make — the same reason `interact` exists for claims that need a click. The part that IS
// isomorphic (`isolate`, per-caller caches, `{ global }`) lives in `demos/scope.ts` where it belongs.
//
// The test that matters here is INTERLEAVING. `isolate` refuses it; this is what `serve` is for.

import { expect, test } from 'bun:test'
import { html, memo, outlet, type RouteEntry, ready, route, routes } from 'abide'
import { bag, cookies, isServing, renderToString, request, serve } from 'abide/server'
import { sleep } from 'abide/tests'

test('two requests interleaving across their awaits do not share a cache', async () => {
    let bodyRuns = 0
    const ticket = memo(async () => {
        bodyRuns++
        const mine = bodyRuns
        await sleep(10)
        return mine
    })

    // The second request starts while the first is parked, and both read after their own awaits —
    // the exact shape one plain variable cannot represent.
    const [first, second] = await Promise.all([
        serve(new Request('https://x.test/a'), async () => {
            const awaited = await ticket
            await sleep(30)
            return [awaited, ticket.peek(), new URL(request().url).pathname]
        }),
        serve(new Request('https://x.test/b'), async () => {
            await sleep(5)
            const awaited = await ticket
            return [awaited, ticket.peek(), new URL(request().url).pathname]
        }),
    ])

    expect(bodyRuns).toBe(2)
    expect(first).toEqual([1, 1, '/a'])
    expect(second).toEqual([2, 2, '/b'])
})

test('a keyed memo is per-request under serve', async () => {
    let bodyRuns = 0
    const profile = memo(({ id }: { id: number }) => {
        bodyRuns++
        return { id, seat: bodyRuns }
    })

    const one = await serve(new Request('https://x.test/'), async () => profile({ id: 7 })())
    const two = await serve(new Request('https://x.test/'), async () => profile({ id: 7 })())

    expect(bodyRuns).toBe(2)
    expect(one).toEqual({ id: 7, seat: 1 })
    expect(two).toEqual({ id: 7, seat: 2 })
})

test('{ global } survives across requests', async () => {
    let bodyRuns = 0
    const config = memo(
        ({ key }: { key: string }) => {
            bodyRuns++
            return `${key}:${bodyRuns}`
        },
        { global: true },
    )

    const one = await serve(new Request('https://x.test/'), async () => config({ key: 'a' })())
    const two = await serve(new Request('https://x.test/'), async () => config({ key: 'a' })())

    expect(bodyRuns).toBe(1)
    expect([one, two]).toEqual(['a:1', 'a:1'])
})

test('a synchronous handler never becomes a promise', () => {
    // Guarded rather than awaited: the common case must not pay a wrap and a tick.
    const produced = serve(new Request('https://x.test/'), () => 'answered in the call')
    expect(produced).toBe('answered in the call')
})

test('the ambients answer for the request being served', async () => {
    const answered = await serve(new Request('https://x.test/deep?q=1'), async () => {
        bag().set('trace', 't-1')
        return {
            url: request().url,
            carried: bag().get('trace'),
            serving: isServing(),
        }
    })

    expect(answered).toEqual({
        url: 'https://x.test/deep?q=1',
        carried: 't-1',
        serving: true,
    })
})

// A hand-made request rather than `new Request(…, { headers: { cookie } })`, because the DOM
// emulator this lane preloads implements the browser rule that `cookie` is a FORBIDDEN header name
// and silently drops it. What is under test is the parse; `headers.get` is not abide's code.
const withCookie = (header: string): Request =>
    ({ headers: { get: (name: string) => (name === 'cookie' ? header : null) } }) as unknown as Request

test('cookies are parsed once per request, and decoded', async () => {
    const answered = await serve(withCookie('session=abc123; theme=dark%20mode; bare'), async () => {
        const first = cookies()
        return {
            session: first.get('session'),
            theme: first.get('theme'),
            // No `=`, so there is no name/value pair to record.
            bare: first.has('bare'),
            // Parsed once: the second ask is the same object, not a second parse.
            cached: cookies() === first,
        }
    })

    expect(answered).toEqual({ session: 'abc123', theme: 'dark mode', bare: false, cached: true })
})

test('a request with no cookie header has no cookies', async () => {
    const answered = await serve(new Request('https://x.test/'), async () => cookies().size)
    expect(answered).toBe(0)
})

test('an ambient outside a request throws rather than guessing', () => {
    expect(isServing()).toBe(false)
    expect(() => request()).toThrow(/outside a request/)
    expect(() => bag()).toThrow(/outside a request/)
})

// --- routing ------------------------------------------------------------------
//
// The seam `abide/server` installs: a request's URL is where that request thinks it is. Here rather
// than in `demos/routing.ts` for the reason at the top of this file — the demos drive a route with an
// explicit `navigate` inside an `isolate`, which is the CLIENT path and never consults the href
// source at all. Two requests at two URLs at once is an ALS claim, and no browser card can make it.

/** A page that is not in the bundle yet, which is what makes `ready()` mean anything. */
const LATE: RouteEntry[] = [
    {
        path: '/users/[id]',
        page: async () => {
            await sleep(5)
            return { default: () => html`<b>user ${() => route().params.id}</b>` }
        },
    },
]

test('a request routes by its own URL, and two do so at once', async () => {
    routes(LATE)

    const [first, second] = await Promise.all([
        serve(new Request('https://x.test/users/1'), async () => {
            await ready()
            return [route().name, route().params.id, await renderToString(outlet())]
        }),
        serve(new Request('https://x.test/users/2'), async () => {
            await ready()
            return [route().name, route().params.id, await renderToString(outlet())]
        }),
    ])

    // The NAME is shared — it is the app's shape — and everything about the caller is not.
    expect(first).toEqual(['/users/[id]', '1', '<b>user 1</b>'])
    expect(second).toEqual(['/users/[id]', '2', '<b>user 2</b>'])
})

test('`ready()` is what makes a server render a snapshot', async () => {
    // A fresh install, so the module this table loads has not landed yet: `routes()` rebuilds every
    // entry, and a view resolved by an earlier test lives on the entry it was resolved into.
    routes(LATE)

    const answered = await serve(new Request('https://x.test/users/7'), async () => {
        // A tree with a hole in it is not a tree. Rendering before the page has arrived is the thing
        // `ready()` exists to make unnecessary, so it has to be observable that it would.
        const early = await renderToString(outlet())
        await ready()
        return [early, await renderToString(outlet())]
    })

    expect(answered).toEqual(['', '<b>user 7</b>'])
})

test('a route already in the bundle is waited on by nothing', async () => {
    routes([{ path: '/', page: () => ({ default: () => html`<b>home</b>` }) }])

    const answered = await serve(new Request('https://x.test/'), async () => {
        // No `ready()` first: a loader that hands its module back in the call has no in-flight window
        // at all, so the page is there the moment the outlet asks for it.
        const straight = await renderToString(outlet())
        // And `ready()` then hands back the ONE settled promise rather than allocating a fresh one
        // per request — which is the whole of what a server pays for routing it did not need.
        const once = ready()
        const again = ready()
        return [straight, once === again]
    })

    expect(answered).toEqual(['<b>home</b>', true])
})

test('a failed handler still drops its scope', async () => {
    let bodyRuns = 0
    const thing = memo(({ id }: { id: number }) => {
        bodyRuns++
        return id
    })

    await expect(
        serve(new Request('https://x.test/'), async () => {
            thing({ id: 1 })()
            throw new Error('handler blew up')
        }),
    ).rejects.toThrow('handler blew up')

    // A fresh request reloads, which is only true if the failed one's cache went away.
    await serve(new Request('https://x.test/'), async () => thing({ id: 1 })())
    expect(bodyRuns).toBe(2)
})
