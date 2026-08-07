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
import { homedir } from 'node:os'
import { dirname, sep } from 'node:path'
import { html, log, memo, outlet, type RouteEntry, ready, remote, route, routes } from 'abide'
import {
    appDataDir,
    bag,
    cookies,
    dispatch,
    isServing,
    json,
    page,
    redirect,
    renderToString,
    request,
    serve,
    trace,
} from 'abide/server'
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

// --- trace ---------------------------------------------------------------------
//
// W3C Trace Context, because the whole value of a trace id is that everything else already agrees on
// one. An id abide invented instead would tie this work to nothing.

test('trace() carries an inbound traceparent, and mints one when there is none', async () => {
    const carried = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'

    const followed = await serve(
        new Request('https://x.test/', {
            headers: { traceparent: `00-${carried}-0011223344556677-01` },
        }),
        async () => {
            // Held for the request: two calls that disagreed about the id would defeat the only
            // thing an id is for.
            const first = trace()
            await sleep(1)
            return [first, trace()]
        },
    )
    expect(followed).toEqual([carried, carried])

    const minted = await serve(new Request('https://x.test/'), async () => trace())
    expect(minted).toMatch(/^[\da-f]{32}$/)
    expect(minted).not.toBe(carried)

    // Two requests with nothing to follow are two operations.
    const another = await serve(new Request('https://x.test/'), async () => trace())
    expect(another).not.toBe(minted)
})

test('a malformed or all-zero traceparent is not followed', async () => {
    const ids = await Promise.all(
        ['nonsense', '00-0-0-0', '00-00000000000000000000000000000000-0011223344556677-01'].map((header) =>
            serve(new Request('https://x.test/', { headers: { traceparent: header } }), () => trace()),
        ),
    )
    for (const id of ids) expect(id).toMatch(/^[\da-f]{32}$/)
    expect(new Set(ids).size).toBe(3)
})

test('trace() outside a request says so rather than guessing', () => {
    expect(() => trace()).toThrow('outside a request')
})

// --- appDataDir ----------------------------------------------------------------

test('appDataDir() is the platform convention under the app name, and ABIDE_DATA_DIR overrides it', () => {
    // A question about the PROCESS rather than about a caller, so it needs no `serve` at all — and
    // asserted as a RELATIONSHIP, because the platform root differs on every machine this runs on.
    const named = withEnv({ ABIDE_APP_NAME: 'docs' }, appDataDir)
    const renamed = withEnv({ ABIDE_APP_NAME: 'ledger' }, appDataDir)

    expect(named.endsWith(`${sep}docs`)).toBe(true)
    expect(renamed.endsWith(`${sep}ledger`)).toBe(true)
    // Same per-user root, different leaf: the app names the directory, the platform names where it is.
    expect(dirname(named)).toBe(dirname(renamed))
    expect(named.startsWith(homedir()) || named.startsWith(Bun.env.XDG_DATA_HOME ?? ' ')).toBe(true)

    // Taken VERBATIM: an operator who named a directory named the directory, not a parent for the
    // app's name to be appended to.
    expect(withEnv({ ABIDE_DATA_DIR: '/tmp/abide-data-dir-test' }, appDataDir)).toBe(
        '/tmp/abide-data-dir-test',
    )
})

/** A few env vars set for one call and put back, so a failure cannot leak into the next test. */
function withEnv<T>(vars: Record<string, string>, fn: () => T): T {
    const held: Record<string, string | undefined> = {}
    for (const name in vars) {
        held[name] = Bun.env[name]
        Bun.env[name] = vars[name] as string
    }
    try {
        return fn()
    } finally {
        for (const name in vars) {
            const was = held[name]
            if (was === undefined) delete Bun.env[name]
            else Bun.env[name] = was
        }
    }
}

test('a span of our own is minted per request, and the response says so', async () => {
    const carried = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
    const request = new Request('https://x.test/', {
        headers: { traceparent: `00-${carried}-0011223344556677-01` },
    })

    const answered = await serve(request, () => ({
        id: trace(),
        span: trace.span(),
        sampled: trace.sampled(),
        // The header a response carries. `parent_id` is OUR span — which is the whole point: the
        // caller stitches its own span to our entry point and the trace is unbroken across the
        // boundary. Echoing the caller's span back would tell them only what they already knew.
        response: trace.responseHeaders().traceresponse,
        // The header an outbound call carries. We become the PARENT of the next hop, which is the
        // entirety of how a trace is "added to": nothing is appended to a traceparent.
        outbound: trace.headers().traceparent,
    }))

    expect(answered.id).toBe(carried)
    expect(answered.span).toMatch(/^[\da-f]{16}$/)
    expect(answered.span).not.toBe('0011223344556677')
    expect(answered.sampled).toBe(true)
    expect(answered.response).toBe(`00-${carried}-${answered.span}-01`)
    expect(answered.outbound).toBe(`00-${carried}-${answered.span}-01`)

    // A span is per REQUEST, so the same operation reaching us twice is two spans.
    const again = await serve(request, () => trace.span())
    expect(again).not.toBe(answered.span)
})

test('the sampling decision is carried, never made here', async () => {
    const id = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
    const unsampled = await serve(
        new Request('https://x.test/', {
            headers: { traceparent: `00-${id}-0011223344556677-00` },
        }),
        () => [trace.sampled(), trace.span(), trace.headers().traceparent],
    )
    // Carried verbatim: abide is not a sampler and does not get a vote.
    expect(unsampled).toEqual([false, unsampled[1], `00-${id}-${unsampled[1] as string}-00`])

    // A trace that STARTS here is sampled and flagged random-trace-id, because we did generate it
    // randomly and abide's own log records it.
    const minted = await serve(new Request('https://x.test/'), () => trace.headers().traceparent)
    expect(minted).toMatch(/^00-[\da-f]{32}-[\da-f]{16}-03$/)
})

test('tracestate is a Map, like bag() and cookies(), and propagates', async () => {
    const id = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
    const withState = (header: string | null, fn: () => unknown): unknown =>
        serve(
            new Request('https://x.test/', {
                headers:
                    header === null
                        ? { traceparent: `00-${id}-0011223344556677-01` }
                        : { traceparent: `00-${id}-0011223344556677-01`, tracestate: header },
            }),
            fn,
        )

    expect(withState('congo=t61rcWkgMzE,rojo=00f067aa0ba902b7', () => [...trace.state()])).toEqual([
        ['congo', 't61rcWkgMzE'],
        ['rojo', '00f067aa0ba902b7'],
    ])

    // Untouched, so the inbound TEXT propagates byte for byte rather than being re-serialised into
    // an equivalent-but-different string.
    expect(withState('congo=t61rcWkgMzE , rojo=1', () => trace.headers().tracestate)).toBe(
        'congo=t61rcWkgMzE , rojo=1',
    )

    // Written, so it is re-serialised from the map — and a write is `.set` on an ordinary Map, not a
    // verb of its own.
    expect(
        withState('congo=t61rcWkgMzE', () => {
            trace.state().set('mine', 'abc')
            return trace.headers().tracestate
        }),
    ).toBe('congo=t61rcWkgMzE,mine=abc')

    // No inbound list and nothing written: the header is absent rather than empty.
    expect(withState(null, () => trace.headers().tracestate)).toBe(undefined)
})

test('every response abide builds carries traceresponse, failures included', async () => {
    const answered = await serve(new Request('https://x.test/'), () => ({
        id: trace(),
        span: trace.span(),
        json: json({ ok: true }).headers.get('traceresponse'),
        // A page render was the one response abide could not reach until `page()` existed, and a
        // hole in the correlation is a hole in exactly the request someone is complaining about.
        page: page('<!doctype html><p>hi</p>').headers.get('traceresponse'),
        redirected: redirect('/elsewhere').headers.get('traceresponse'),
    }))

    const expected = `00-${answered.id}-${answered.span}-03`
    expect([answered.json, answered.page, answered.redirected]).toEqual([expected, expected, expected])

    // A dispatch refusal too: a 404 is the response you most want to correlate.
    const refused = await serve(new Request('https://x.test/__abide/rpc/nope'), () =>
        dispatch(new Request('https://x.test/__abide/rpc/nope')),
    )
    expect((refused as Response).headers.get('traceresponse')).toMatch(/^00-[\da-f]{32}-[\da-f]{16}-\d\d$/)
})

test('outside a request nothing is invented', () => {
    // A response built with no caller carries no header at all, rather than a trace id standing for
    // an operation that does not exist.
    expect(json({ ok: true }).headers.get('traceresponse')).toBe(null)
    expect(() => trace.span()).toThrow('outside a request')
})

test('an outbound rpc continues the trace rather than starting one', async () => {
    // What the next hop was handed. `remote` is the client half — the same stub a browser loads —
    // so this is the real propagation path, not a stand-in for it.
    const seen: (string | null)[] = []
    const call = remote<{ q: string }, string>('search/run', {
        base: 'https://downstream.test',
        fetch: (_input, init) => {
            seen.push(new Headers(init.headers).get('traceparent'))
            return Promise.resolve(new Response('"ok"', { headers: { 'content-type': 'application/json' } }))
        },
    })

    const answered = await serve(new Request('https://x.test/'), async () => {
        const value = await call({ q: 'a' })
        // The mutation path too — a read travels as a GET with its args in the query, a mutation as
        // its own method with a body, and the two build their headers separately.
        const mutation = remote<{ id: number }, string>('users/rename', {
            method: 'POST',
            base: 'https://downstream.test',
            fetch: (_input, init) => {
                seen.push(new Headers(init.headers).get('traceparent'))
                return Promise.resolve(
                    new Response('"ok"', { headers: { 'content-type': 'application/json' } }),
                )
            },
        })
        await mutation({ id: 1 })
        return { value, id: trace(), span: trace.span() }
    })

    expect(answered.value).toBe('ok')
    // Both hops name US as the parent, which is what makes the downstream span a child of ours.
    const expected = `00-${answered.id}-${answered.span}-03`
    expect(seen).toEqual([expected, expected])
})

test('a client invents no trace, and an explicit one is not overruled', async () => {
    const seen: (string | null)[] = []
    const send = (_input: string, init: RequestInit): Promise<Response> => {
        seen.push(new Headers(init.headers).get('traceparent'))
        return Promise.resolve(new Response('"ok"', { headers: { 'content-type': 'application/json' } }))
    }
    const call = remote<{ q: string }, string>('search/run', { base: 'https://downstream.test', fetch: send })

    // No request scope at all — a browser, a script. There is no operation to belong to, and one
    // invented here would assert a relationship to work it cannot see.
    await call({ q: 'a' })

    // Inside a request, but the caller said where this call belongs. A framework default has no
    // business overruling somebody being explicit.
    const mine = '00-ffffffffffffffffffffffffffffffff-1122334455667788-01'
    await serve(new Request('https://x.test/'), () =>
        call.raw({ q: 'b' }, { headers: { traceparent: mine } }),
    )

    expect(seen).toEqual([null, mine])
})

test('a log line carries the operation it belongs to', async () => {
    const written: string[] = []
    const held = console.log
    console.log = (...args: unknown[]) => void written.push(args.map(String).join(' '))
    const format = Bun.env.ABIDE_LOG_FORMAT
    Bun.env.ABIDE_LOG_FORMAT = 'json'
    try {
        log('outside a request')
        const id = await serve(new Request('https://x.test/'), () => {
            log('inside one')
            return trace()
        })

        const lines = written.map((text) => JSON.parse(text) as { message: string; trace: string | null })
        // The id is not something the call site passed: `log(string)` still takes a string and
        // nothing else, and the field arrives from the scope the line was written in.
        expect(lines.map((line) => [line.message, line.trace])).toEqual([
            ['outside a request', null],
            ['inside one', id],
        ])
    } finally {
        console.log = held
        if (format === undefined) delete Bun.env.ABIDE_LOG_FORMAT
        else Bun.env.ABIDE_LOG_FORMAT = format
    }
})
