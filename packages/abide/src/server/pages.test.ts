// M5a — server-side page SSR. A `page.abide` source served as a full HTML document via the router,
// with in-proc RPC reads (memo) during render and route() available in the template. Pages run
// through the middleware onion like any request.

import { expect, test } from 'bun:test'
import { error } from '../server/error.ts'
import { GET } from '../server/GET.ts'
import type { Middleware } from '../server/internal/middleware.ts'
import { warmPages } from '../server/internal/pages.ts'
import { onScopeDispose } from '../shared/internal/reactiveScope.ts'
import { createTestApp } from '../test/createTestApp.ts'
import { loadEmittedServer } from '../ui/internal/emit.ts'

// SSR HTML now carries the client skeleton's comment anchors; strip them for structural assertions.
function stripAnchors(html: string): string {
    return html.replace(/<!--\[-->|<!--\]-->|<!---->/g, '')
}

// The inline/stream classification is a WALL-CLOCK race against `ABIDE_SSR_DEADLINE` (4ms by default).
// Under `bun test --parallel` the box carries one worker per core, and a genuinely fast in-proc read —
// plus createTestApp's cold first compile — can miss 4ms, flipping an inline assertion to a patch. The
// tests asserting the INLINE side therefore pin a deadline no in-proc read could cross; the SLOW-side
// tests keep the default, since their reads outlast any deadline by construction, not by luck.
async function withSsrDeadline<T>(ms: number, run: () => Promise<T>): Promise<T> {
    const previous = process.env.ABIDE_SSR_DEADLINE
    process.env.ABIDE_SSR_DEADLINE = String(ms)
    try {
        return await run()
    } finally {
        if (previous === undefined) delete process.env.ABIDE_SSR_DEADLINE
        else process.env.ABIDE_SSR_DEADLINE = previous
    }
}

test('SSRs a page as a full HTML document with an in-proc RPC read', async () => {
    const app = await createTestApp({
        routes: { greet: GET(({ name }: { name: string }) => `hi ${name}`) },
        pages: {
            '/': "<script>import { state } from 'abide/shared/state'; import greet from '../../server/rpc/greet'; let title = state('Home')</script><main><h1>{title}</h1><p>{await greet({name:'ada'})}</p></main>",
        },
    })

    const response = await app.fetch('/')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')

    const body = await response.text()
    expect(body).toContain('<!doctype html>')
    expect(body).toContain('<div id="__abide-app">')
    expect(stripAnchors(body)).toContain('<h1>Home</h1>')
    expect(body).toContain('hi ada')

    await app.stop()
})

test('a fast {#await} block renders inline — no placeholder/patch (PR2 deadline)', async () => {
    const app = await createTestApp({
        routes: { quick: GET(() => 'INLINE') },
        pages: {
            '/': "<script>import quick from '../../server/rpc/quick'</script><main>{#await quick()}<span>loading</span>{:then v}<b>{v}</b>{/await}</main>",
        },
    })

    const body = await withSsrDeadline(2_000, async () => (await app.fetch('/')).text())
    // A read that settles within the macrotask deadline renders inline — byte-identical shape to before.
    expect(stripAnchors(body)).toContain('<b>INLINE</b>')
    expect(body).not.toContain('ab-p:0')
    expect(body).not.toContain('data-ab-patch')
    expect(body).not.toContain('loading')

    await app.stop()
})

test('a slow {#await} block streams as an out-of-order patch (PR2)', async () => {
    const app = await createTestApp({
        routes: {
            slow: GET(async () => {
                await new Promise((resolve) => setTimeout(resolve, 15))
                return 'PATCHED'
            }),
        },
        pages: {
            '/': "<script>import slow from '../../server/rpc/slow'</script><main>{#await slow()}<span>loading</span>{:then v}<b>{v}</b>{/await}</main>",
        },
    })

    const body = await (await app.fetch('/')).text()
    // The shell flushes the sentinel-bracketed placeholder with the pending fallback...
    expect(body).toContain('<!--ab-p:0-->')
    expect(body).toContain('<template id="ab-p:0"></template>')
    expect(body).toContain('loading')
    // ...and the resolved value arrives LATER as an out-of-order <template> patch + move-script.
    expect(body).toContain('<template data-ab-patch="0">')
    expect(stripAnchors(body)).toContain('<b>PATCHED</b>')
    expect(body).toContain('$abidePatch(0)')
    // Ordering: the slot precedes its patch, and the value streamed (only inside the patch, not the shell).
    expect(body.indexOf('<template id="ab-p:0"></template>')).toBeLessThan(
        body.indexOf('<template data-ab-patch="0">'),
    )
    expect(body.indexOf('PATCHED')).toBeGreaterThan(body.indexOf('<template data-ab-patch="0">'))

    await app.stop()
})

test('a fast {#await} error with no {:catch} → controlled 500 before first flush (PR5)', async () => {
    const app = await createTestApp({
        routes: {
            boom: GET(() => {
                throw new Error('kaboom')
            }),
        },
        pages: {
            '/': "<script>import boom from '../../server/rpc/boom'</script><main>{#await boom()}<span>loading</span>{:then v}<b>{v}</b>{/await}</main>",
        },
    })

    // The read settles (rejects) within the deadline, so it renders inline; with no {:catch} that rethrows
    // BEFORE the shell flushes → a controlled 500 (the TODO #7 guarantee holds for streaming forms too).
    const response = await withSsrDeadline(2_000, () => app.fetch('/'))
    expect(response.status).toBe(500)

    await app.stop()
})

test('a slow {#await} error WITH {:catch} streams the catch branch as a patch (PR5)', async () => {
    const app = await createTestApp({
        routes: {
            slowBoom: GET(async () => {
                await new Promise((resolve) => setTimeout(resolve, 15))
                throw new Error('slow-kaboom')
            }),
        },
        pages: {
            '/': "<script>import slowBoom from '../../server/rpc/slowBoom'</script><main>{#await slowBoom()}<span>loading</span>{:then v}<b>{v}</b>{:catch e}<i>{e.message}</i>{/await}</main>",
        },
    })

    const response = await app.fetch('/')
    expect(response.status).toBe(200) // shell already flushed — the error rides in as a patch, not a 500
    const body = await response.text()
    expect(body).toContain('<template id="ab-p:0"></template>') // placeholder in the shell
    expect(body).toContain('<template data-ab-patch="0">') // the {:catch} branch streamed as a patch
    expect(stripAnchors(body)).toContain('slow-kaboom')

    await app.stop()
})

test('a slow {#await} error with NO {:catch} → 200 with an empty patch that clears the slot (PR5)', async () => {
    const app = await createTestApp({
        routes: {
            slowBoom: GET(async () => {
                await new Promise((resolve) => setTimeout(resolve, 15))
                throw new Error('uncaught-stream-error')
            }),
        },
        pages: {
            '/': "<script>import slowBoom from '../../server/rpc/slowBoom'</script><main>{#await slowBoom()}<span>loading</span>{:then v}<b>{v}</b>{/await}</main>",
        },
    })

    const response = await app.fetch('/')
    expect(response.status).toBe(200) // headers already flushed → cannot 500; the subtree degrades
    const body = await response.text()
    // An empty patch clears the pending fallback rather than leaving a stuck spinner (server also logs).
    expect(body).toContain('<template data-ab-patch="0"></template>')

    await app.stop()
})

// (Fast/synchronous `{#for await}` draining inline — byte-identical to the buffered path — is proven by
// the emit oracle's `for await` fixtures via the no-stream-scope full drain; not re-tested here because
// createTestApp's cold first-compile can elapse the 4ms deadline before render, deferring even a fast
// stream. The real app warms pages, so the deadline is meaningful.)

test('a slow {#for await} streams its items as append-patches (PR6)', async () => {
    const app = await createTestApp({
        pages: {
            '/': "<script>const slowGen = async function*(){ for (const l of ['a','b','c']){ await new Promise((r)=>setTimeout(r,15)); yield l } }</script><main>{#for await chunk of slowGen()}<span>{chunk}</span>{/for}</main>",
        },
    })

    const body = await (await app.fetch('/')).text()
    // The shell flushes the bare list sentinel, then each item streams as an append-patch...
    expect(body).toContain('<template id="ab-l:0"></template>')
    expect(body).toContain('<template data-ab-append="0">')
    expect(body).toContain('$abideAppend(0)')
    expect(stripAnchors(body)).toContain('<span>a</span>')
    expect(stripAnchors(body)).toContain('<span>c</span>')
    // ...and that is the whole protocol. The document used to also carry an `$abideDone` move-script
    // per streamed list, whose only effect was stamping `data-ab-done` on the sentinel — an attribute
    // nothing read. `done()` is driven by `markIterableDone`, not by the DOM.
    expect(body).not.toContain('$abideDone')
    expect(body).not.toContain('data-ab-done')

    await app.stop()
})

test('route() is available inside a page template (kind = nav)', async () => {
    const app = await createTestApp({
        pages: {
            '/x': "<script>import { route } from 'abide/shared/route'</script><span>{route().kind}</span>",
        },
    })

    const response = await app.fetch('/x')
    expect(response.status).toBe(200)
    const body = await response.text()
    expect(stripAnchors(body)).toContain('<span>nav</span>')

    await app.stop()
})

test('an unknown path still 404s; RPC + openapi unaffected', async () => {
    const app = await createTestApp({
        routes: { greet: GET(({ name }: { name: string }) => `hi ${name}`) },
        pages: { '/': '<h1>ok</h1>' },
    })

    const notFound = await app.fetch('/nope')
    expect(notFound.status).toBe(404)

    const rpcResponse = await app.fetch(
        `/__abide/rpc/greet?__abide_args=${encodeURIComponent(JSON.stringify({ name: 'z' }))}`,
    )
    expect(rpcResponse.status).toBe(200)
    expect(await rpcResponse.json()).toBe('hi z')

    const openapi = await app.fetch('/openapi.json')
    expect(openapi.status).toBe(200)
    expect((await openapi.json()).openapi).toBe('3.1.0')

    await app.stop()
})

test('warmPages pre-compiles every page + layout so first-hit SSR is cache-warm', async () => {
    // Unique sources so the module cache starts cold for this test (the caches are module-global).
    const page = '<p>warm-page-3f9a</p>'
    const layout = '<section>warm-layout-3f9a {children()}</section>'

    await warmPages({
        pages: { '/warm': page },
        layouts: { '/': layout },
    })

    // A warmed source resolves SYNCHRONOUSLY afterward: `Bun.peek` returns the settled module (not the
    // promise) only when warmPages already awaited the cold compile. A cold call would still be pending.
    for (const source of [page, layout]) {
        const pending = loadEmittedServer(source)
        const settled = Bun.peek(pending)
        expect(settled).not.toBe(pending) // settled → warm primed it (a cold compile would still be pending)
        expect(typeof (settled as { render?: unknown }).render).toBe('function')
    }
})

test('warmPages is resilient — a broken page is logged and skipped, good pages still warm', async () => {
    // A component import with no source dir throws during emit; warmPages must catch it, not reject.
    const broken = "<script>import Missing from './Missing.abide'</script><Missing/>"
    const good = '<p>warm-good-7c2b</p>'

    await expect(
        warmPages({ pages: { '/broken': broken, '/good': good } }),
    ).resolves.toBeUndefined()

    const settled = Bun.peek(loadEmittedServer(good))
    expect(typeof (settled as { render?: unknown }).render).toBe('function')
})

test('a short-circuiting middleware blocks the SSR page', async () => {
    const guard: Middleware = () => error(403, 'nope')
    const app = await createTestApp({
        middleware: [guard],
        pages: { '/': '<h1>secret</h1>' },
    })

    const response = await app.fetch('/')
    expect(response.status).toBe(403)
    const body = await response.text()
    expect(body).not.toContain('secret')

    await app.stop()
})

// ── ADR 0026 D1 gate — disposal accounting ─────────────────────────────────────────────────────────
//
// A request's reactive context is disposed exactly ONCE, and for a STREAMED reply that happens after
// the drain finishes, not when the handler returns — the response body is still being produced. Today
// that is expressed by `runInScope` branching on `context.stream`; D1 replaces it with a retain/release
// refcount so the primitive stops knowing what a stream is. These cases pin the OBSERVABLE contract so
// the swap cannot change it: premature disposal would tear down the memo slots the drain is still
// reading, and a missed release would leak every request's effect subscriptions onto module state.

function disposalProbe(): { count: () => number; register: () => void } {
    let count = 0
    return {
        count: () => count,
        register: () => {
            onScopeDispose(() => {
                count++
            })
        },
    }
}

test('a BUFFERED page disposes its context exactly once, by the time the response resolves', async () => {
    const probe = disposalProbe()
    const app = await createTestApp({
        routes: {
            mark: GET(() => {
                probe.register()
                return 'ok'
            }),
        },
        pages: { '/': "<script>import mark from 'abide-rpc:mark'</script><p>{await mark()}</p>" },
    })

    const body = await (await app.fetch('/')).text()
    expect(stripAnchors(body)).toContain('<p>ok</p>')
    expect(probe.count()).toBe(1)

    await app.stop()
})

test('a STREAMED page defers disposal until the drain completes, then disposes exactly once', async () => {
    const probe = disposalProbe()
    // The read is held open by an explicit GATE, not a timer: the assertion below is "the shell flushed
    // and the read has NOT landed", and a 40ms sleep only wins that race while the box is idle.
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
        release = resolve
    })
    const app = await createTestApp({
        routes: {
            slow: GET(async () => {
                probe.register()
                await gate
                return 'late'
            }),
        },
        pages: {
            '/': "<script>import slow from 'abide-rpc:slow'</script><main>{#await slow()}<i>pending</i>{:then v}<p>{v}</p>{/await}</main>",
        },
    })

    const response = await app.fetch('/')
    const reader = (response.body as ReadableStream<Uint8Array>).getReader()

    // The shell has flushed (placeholder present) but the slow read has not landed, so the request's
    // work is NOT finished and the context must still be alive.
    const first = new TextDecoder().decode((await reader.read()).value)
    expect(first).toContain('<template id="ab-p:0">')
    expect(first).toContain('<i>pending</i>')
    expect(probe.count()).toBe(0)

    release()
    let rest = ''
    for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        rest += new TextDecoder().decode(value)
    }
    expect(rest).toContain('late')
    expect(probe.count()).toBe(1)

    await app.stop()
})

// SCOPE-PROVIDED SPECIFIERS AND WHO SUPPLIES THEM.
//
// Being on `SCOPE_PROVIDED` means the emitters REFUSE to emit a real import for a specifier and write
// `const x = $scope["x"]` instead — a promise that something puts `x` in the scope. `context` and
// `server` were on that list and supplied by NEITHER scope builder, so importing either compiled
// cleanly, type-checked cleanly (the check lane copies the import verbatim), and threw
// `context is not a function` on first render. The table now names each specifier's supplying side and
// the two builders are typed from it, so an unsupplied entry is a compile error; this asserts the
// other half — that every server-side name actually resolves to its accessor at render.
test('every server-side scope-provided ambient resolves during SSR', async () => {
    const app = await createTestApp({
        pages: {
            '/': [
                '<script>',
                "import { request } from 'abide/server/request'",
                "import { cookies } from 'abide/server/cookies'",
                "import { context } from 'abide/server/context'",
                "import { server } from 'abide/server/server'",
                'const reached = [',
                '  typeof request().url,',
                '  typeof cookies().get,',
                '  typeof context(),',
                '  typeof server().port,',
                "].join(',')",
                '</script><main>{reached}</main>',
            ].join('\n'),
        },
    })
    try {
        const html = await (await app.fetch('/')).text()
        expect(html).toContain('string,function,object,number')
    } finally {
        await app.stop()
    }
})
