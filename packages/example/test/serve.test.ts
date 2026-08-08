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
import {
    health,
    html,
    identity,
    log,
    memo,
    outlet,
    type RouteEntry,
    ready,
    remote,
    route,
    routes,
} from 'abide'
import {
    appDataDir,
    bag,
    cookies,
    dispatch,
    isServing,
    json,
    onIdentity,
    page,
    redirect,
    renderToString,
    request,
    serve,
    trace,
} from 'abide/server'
import { sleep } from 'abide/tests'
import { withEnv, writeEnv } from '../demos/env.ts'

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

// A real request: the preload keeps Bun's `Request` rather than the emulator's, which implements the
// browser rule that `cookie` is a FORBIDDEN header name and drops one silently. A server is not a
// browser, and a server test that could not describe the caller it is testing was the cost.
const withCookie = (header: string): Request =>
    new Request('https://x.test/', { headers: { cookie: header } })

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

test('appDataDir() is the platform convention under the app name, and ABIDE_DATA_DIR overrides it', async () => {
    // A question about the PROCESS rather than about a caller, so it needs no `serve` at all — and
    // asserted as a RELATIONSHIP, because the platform root differs on every machine this runs on.
    const named = await withEnv({ ABIDE_APP_NAME: 'docs' }, appDataDir)
    const renamed = await withEnv({ ABIDE_APP_NAME: 'ledger' }, appDataDir)

    expect(named.endsWith(`${sep}docs`)).toBe(true)
    expect(renamed.endsWith(`${sep}ledger`)).toBe(true)
    // Same per-user root, different leaf: the app names the directory, the platform names where it is.
    expect(dirname(named)).toBe(dirname(renamed))
    expect(named.startsWith(homedir()) || named.startsWith(Bun.env.XDG_DATA_HOME ?? ' ')).toBe(true)

    // Taken VERBATIM: an operator who named a directory named the directory, not a parent for the
    // app's name to be appended to.
    expect(await withEnv({ ABIDE_DATA_DIR: '/tmp/abide-data-dir-test' }, appDataDir)).toBe(
        '/tmp/abide-data-dir-test',
    )
})

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

test('asking a downstream app for its health CONTINUES the trace', async () => {
    const id = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
    const sent: (Record<string, string> | undefined)[] = []
    const record = (_input: string, init: RequestInit): Promise<Response> => {
        sent.push(init.headers as Record<string, string> | undefined)
        return Promise.resolve(Response.json({ reachable: true }))
    }

    const span = await serve(
        new Request('https://x.test/', { headers: { traceparent: `00-${id}-0011223344556677-01` } }),
        async () => {
            await health({ base: 'https://downstream.test', fetch: record })
            return trace.span()
        },
    )

    // The one abide-built outbound call that used to start a fresh trace. A health check of a
    // dependency belongs to the operation that asked for it, or correlating the two is guesswork.
    expect(sent[0]?.traceparent).toBe(`00-${id}-${span}-01`)

    // And outside a request there is nothing to belong to, so the init stays unallocated rather than
    // carrying an id this caller invented.
    await health({ base: 'https://downstream.test', fetch: record })
    expect(sent[1]).toBeUndefined()
})

// --- identity ----------------------------------------------------------------
//
// The half of the principal a browser card cannot show, for the same reason as everything else in
// this file: signing somebody in needs a REQUEST, and a request needs `AsyncLocalStorage`. What IS
// isomorphic — the anonymous floor, the two writers refusing off a client — is in `demos/identity.ts`.

/** Log in, and hand back the `Set-Cookie` the response carried, which is the whole seal. */
async function login(claims: unknown): Promise<string> {
    const line = await serve(new Request('https://x.test/'), async () => {
        await identity.set(claims)
        // Built through an ordinary response helper, because that is the claim: nothing in a handler
        // attaches this. `headersFor` is the one funnel, the same one `traceresponse` rides.
        return json({ ok: true }).headers.get('set-cookie')
    })
    return line as string
}

/** The `name=value` pair on its own — what a browser would send back. */
function cookieOf(line: string): string {
    return line.slice(0, line.indexOf(';'))
}

/** Serve one request carrying a cookie, and answer with whatever the body asked. */
function as<T>(cookie: string, fn: () => Promise<T>): Promise<T> {
    return serve(withCookie(cookie), fn)
}

/** Resolve as the caller holding `cookie`, and hand back the `Set-Cookie` that request wrote — if any. */
function reseal(cookie: string): Promise<string | null> {
    return as(cookie, async () => {
        await identity()
        return json({}).headers.get('set-cookie')
    })
}

test('a sealed principal round-trips, and the cookie is not readable by a browser', async () => {
    const line = await login({ id: 'u1', name: 'Ada' })

    // Every attribute here is load-bearing. HttpOnly because nothing in the browser half reads this
    // — it asks the endpoint instead, which is the whole reason that endpoint exists — and Lax so a
    // cross-site POST cannot ride the session while an ordinary link in still arrives signed in.
    expect(line).toContain('abide-identity=')
    expect(line).toContain('HttpOnly')
    expect(line).toContain('SameSite=Lax')
    expect(line).toContain('Path=/')
    // Not `Secure`, because this is not production: a development server on http://localhost would
    // otherwise set a cookie the browser discards, which reads as "login is broken".
    expect(line).not.toContain('Secure')

    const who = await as(cookieOf(line), () => identity())
    expect(who.authenticated).toBe(true)
    expect(who.id).toBe('u1')
    expect(who.name).toBe('Ada')
    // The floor abide fills in, beside the claims the app sealed.
    expect(Date.parse(who.expiresAt as string)).toBeGreaterThan(Date.now())

    // The REST of the request that logs somebody in sees who they now are, not who the inbound
    // cookie said. Re-reading the request would answer with the seal still on it, which is how a
    // handler that signs a caller in and then renders shows the previous visitor.
    const during = await serve(new Request('https://x.test/'), async () => {
        const before = await identity()
        await identity.set({ id: 'u2' })
        return [before.authenticated, (await identity()).id]
    })
    expect(during).toEqual([false, 'u2'])
})

test('a tampered seal is anonymous, and says nothing about which half was wrong', async () => {
    const cookie = cookieOf(await login({ id: 'u1', role: 'reader' }))

    // The claims are readable — a user seeing their own id is not a leak — so this is an attacker
    // editing the part they can read and re-sending it. The MAC is over that text.
    const [name, sealed] = cookie.split('=') as [string, string]
    const [body, mac] = sealed.split('.') as [string, string]
    const edited = new TextEncoder()
        .encode(JSON.stringify({ c: { id: 'u1', role: 'admin' }, e: Date.now() + 60_000 }))
        .toBase64({ alphabet: 'base64url', omitPadding: true })

    const forged = await as(`${name}=${edited}.${mac}`, () => identity())
    expect(forged.authenticated).toBe(false)
    expect(forged.role).toBeUndefined()

    // A seal whose BODY is ours and whose signature is not fails the same way, and the two are
    // deliberately indistinguishable to the caller: one answer for every reason a seal is not ours.
    const swapped = await as(`${name}=${body}.${'A'.repeat(mac.length)}`, () => identity())
    expect(swapped).toEqual(forged)

    // And so is a cookie that never had a seal in it at all.
    expect(await as(`${name}=nonsense`, () => identity())).toEqual(forged)
})

test('a lapsed seal is anonymous however good its signature is', async () => {
    // Sealed with a life measured in milliseconds, so it is genuinely expired rather than
    // hand-written past its own expiry — the signature over it is real.
    const cookie = await withEnv({ ABIDE_IDENTITY_TTL: '1' }, async () => cookieOf(await login({ id: 'u1' })))
    await sleep(5)
    expect((await as(cookie, () => identity())).authenticated).toBe(false)
})

test('a session in use rolls, and one with most of its life left does not', async () => {
    const cookie = await withEnv({ ABIDE_IDENTITY_TTL: '60000' }, async () => {
        const sealed = cookieOf(await login({ id: 'u1' }))
        // Most of its life left: rolling does not mean a Set-Cookie on every response. It costs
        // bytes on every one and makes each response unique to a proxy.
        expect(await reseal(sealed)).toBeNull()
        return sealed
    })

    // Raising the TTL makes the SAME seal past half spent, which is what an old session is.
    const rolled = await withEnv({ ABIDE_IDENTITY_TTL: '600000' }, () => reseal(cookie))
    expect(rolled).toContain('abide-identity=')
    // Extended rather than re-issued as a new session: the claims survive the refresh.
    expect((await as(cookieOf(rolled as string), () => identity())).id).toBe('u1')
})

test('clear expires the cookie rather than dropping it', async () => {
    const cookie = cookieOf(await login({ id: 'u1' }))

    const line = await as(cookie, async () => {
        expect((await identity()).authenticated).toBe(true)
        identity.clear()
        // Cleared for the REST of this request too, not only the next one: a handler that signs
        // somebody out and then renders must not render them signed in.
        expect((await identity()).authenticated).toBe(false)
        return json({}).headers.get('set-cookie')
    })

    // A cookie the server merely stops mentioning is one the browser keeps sending.
    expect(line).toContain('Max-Age=0')
})

test('a resolver turns claims into a principal, and fails CLOSED', async () => {
    const cookie = cookieOf(await login({ id: 'u1' }))

    const off = onIdentity((claims) => ({
        role: (claims as { id: string }).id === 'u1' ? 'admin' : 'reader',
    }))
    const resolved = await as(cookie, () => identity())
    expect(resolved.authenticated).toBe(true)
    expect(resolved.role).toBe('admin')
    // The claims are what the resolver was HANDED, not what it returns — it said nothing about `id`.
    expect(resolved.id).toBeUndefined()
    off()

    // An anonymous caller reaches the resolver too, with `null`, which is what lets one authenticate
    // off something other than the cookie.
    const seen: unknown[] = []
    const offAnonymous = onIdentity((claims) => {
        seen.push(claims)
        return null
    })
    await serve(new Request('https://x.test/'), () => identity())
    expect(seen).toEqual([null])
    offAnonymous()

    // And this is where identity parts company with health. A reporter that throws is an app saying
    // it is not working and the health document says so; a resolver that throws is an app that could
    // not decide who this is, and the only safe reading of that is nobody.
    const offBroken = onIdentity(() => {
        throw new TypeError('the directory is down')
    })
    const failed = await as(cookie, () => identity())
    expect(failed.authenticated).toBe(false)
    expect(failed.error).toEqual({ name: 'TypeError', message: 'the directory is down' })
    offBroken()
})

test('one resolve per request, however many times it is asked', async () => {
    const cookie = cookieOf(await login({ id: 'u1' }))
    let runs = 0
    const off = onIdentity((claims) => {
        runs++
        return claims as object
    })

    const [first, second] = await as(cookie, async () => Promise.all([identity(), identity()]))
    // The promise is held, not the document — two asks in one request share the one resolve rather
    // than racing two of them, which for a resolver that hits a database is the whole difference.
    expect(runs).toBe(1)
    expect(first).toBe(second)

    // A different request is a different caller, so it resolves again.
    await as(cookie, () => identity())
    expect(runs).toBe(2)
    off()
})

test('production refuses to seal without a declared secret', async () => {
    await withEnv({ NODE_ENV: 'production', ABIDE_IDENTITY_SECRET: undefined }, async () => {
        await expect(serve(new Request('https://x.test/'), () => identity.set({ id: 'u1' }))).rejects.toThrow(
            'ABIDE_IDENTITY_SECRET is required in production',
        )

        // Declared, and now it seals — and carries `Secure`, which it must not outside production.
        const line = await withEnv({ ABIDE_IDENTITY_SECRET: 'a-real-secret' }, () => login({ id: 'u1' }))
        expect(line).toContain('Secure')

        // A seal from one secret does not verify under another: rotating the key signs everybody
        // out, which is what rotating a key is for.
        const rotated = await withEnv({ ABIDE_IDENTITY_SECRET: 'a-different-secret' }, () =>
            as(cookieOf(line), () => identity()),
        )
        expect(rotated.authenticated).toBe(false)
    })
})

test('the endpoint answers about the caller that asked, and is never cached', async () => {
    const cookie = cookieOf(await login({ id: 'u1', name: 'Ada' }))

    const answered = (await dispatch(
        new Request('https://x.test/__abide/identity', { headers: { cookie } }),
    )) as Response
    expect(answered.status).toBe(200)
    // Per-caller by construction, so anything caching it would hand one visitor another's principal.
    expect(answered.headers.get('cache-control')).toBe('no-store')
    expect(await answered.json()).toMatchObject({ authenticated: true, id: 'u1', name: 'Ada' })

    // The same address with no cookie is a different caller, and gets the floor.
    const anonymous = (await dispatch(new Request('https://x.test/__abide/identity'))) as Response
    expect(await anonymous.json()).toMatchObject({ authenticated: false })
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
    // The shape is answered from the configured document, which is memoised for the process — so a
    // variable set after something already asked is one nothing would read. `writeEnv` drops it.
    writeEnv('ABIDE_LOG_FORMAT', 'json')
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
        writeEnv('ABIDE_LOG_FORMAT', format)
    }
})
