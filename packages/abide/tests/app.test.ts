// SECTIONS 37 AND 42 — the lifecycle hooks a root layout's `<script server>` calls, and the `App`
// they wrap.
// Served by `abide start`, and held in process by a script calling `createApp` — both spawned, for
// `serve.test.ts`'s reason: happy-dom's preload clobbers `Response`.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { spawned } from '@abide/harness/gate'
import abidePackage from '../package.json' with { type: 'json' }
import {
    appFixture,
    BIN,
    buildApp,
    lastLinePrinted,
    serveApp,
    startApp,
} from './builtApp.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

const PAGE = `<main><h1>home</h1></main>`

// One handler file a handler (16.73), each answered at its own path below `probe`.
const IMPORTS = `import { config, cookies, GET, POST, request, response, trace } from '@abide/abide/server'\n\n`

const HANDLERS: Record<string, string> = {
    'probe/settings.ts': `${IMPORTS}export default GET(() => {
    const resolved = config()
    return {
        limit: resolved.LIMIT,
        feature: resolved.FEATURE,
        label: resolved.LABEL,
        name: resolved.APP_NAME,
        dataDir: String(resolved.APP_DATA_DIR).endsWith('/fixture'),
    }
})
`,
    'probe/remember.ts': `${IMPORTS}export default POST(() => {
    const theme = cookies().get('theme')
    cookies().set('seen', '1')
    cookies().set('session', 'abc', { httpOnly: true })
    return theme
})
`,
    'probe/seen.ts': `${IMPORTS}export default GET(() => response().headers.get('x-rung') ?? 'none')
`,
    'probe/rewritten.ts': `${IMPORTS}export default GET(() => request().headers.get('x-rewritten') ?? 'the original')
`,
    'probe/traced.ts': `${IMPORTS}export default GET(() =>
    trace.span('lookup', () => ({
        id: trace(),
        sampled: trace.sampled(),
        parent: trace.headers().traceparent,
    })),
)
`,
}

// Every hook, each leaving a mark a request or a script can read back.
const APP = `import { cookies, middleware, onConfig, onError, onHealth, onStart, onStop, redirect, request, response } from '@abide/abide/server'
import { marks } from './lib/marks.server.ts'

onConfig(() => ({ LIMIT: 5, FEATURE: false, LABEL: 'default' }))
onHealth(() => ({ db: 'up', version: 'the app wins' }))

onStart(async (start) => {
    marks.push('before start')
    await start()
    marks.push('after start')
})
onStop(async (stop) => {
    await stop()
    marks.push('stopped')
})
onError((error) => {
    marks.push(\`error: \${(error as Error).message}\`)
})

middleware(async (next, { request: asked }) => {
    // 22.9 through a rung: collected onto the response the lane builds.
    response().headers.set('x-rung', 'outer')
    const answer = await next()
    answer.headers.set('x-onion', \`outer(\${answer.headers.get('x-onion') ?? ''})\`)
    return answer
})
middleware(async (next, { request: asked }) => {
    // 16.16 — a rung that answers in the route's place.
    if (new URL(asked.url).pathname === '/short') return new Response('short-circuited')
    const answer = await next()
    answer.headers.set('x-onion', 'inner')
    return answer
})
middleware(async (next, { request: asked }) => {
    // 30.16 — a rung that decides a page: a redirect written through \`response\`, and a refusal
    // answered in the page's place.
    const path = new URL(asked.url).pathname
    if (path === '/invoices/moved') redirect('/invoices/42')
    if (path === '/invoices/refused') return new Response('refused', { status: 403 })
    return next()
})
middleware(async (next, { request: asked }) => {
    // 37.3 — a rung that hands the lane a request of its own.
    if (asked.headers.get('x-rewrite') === null) return next()
    const headers = new Headers(asked.headers)
    headers.set('x-rewritten', 'by the rung')
    return next({ request: new Request(asked, { headers }) })
})

middleware(async (next, { request: asked }) => {
    // 37.3 — an address nothing else answers, answered by a root rung in the app's own name.
    const path = new URL(asked.url).pathname
    if (path === '/own') return new Response(\`own route for \${request().method}\`)
    if (path === '/own-cookie') {
        cookies().set('from', 'own')
        return new Response('set')
    }
    if (path === '/explode') throw new Error('the app route blew up')
    return next()
})
`

// 23.1 — A PAGE READS WHERE IT IS off `route`, and `online` answers true on a server (23.8).
const WHERE = `<script>
import { online, route } from '@abide/abide'
</script>

<main><p id="where">{route.name()}|{route.params().id}|{route.url().pathname}|{route.navigating()}|{online()}</p>
<p id="named">{route.name.toUpperCase()}|{route.params.id}|{route.url.pathname}|{route.navigating ? 'moving' : 'still'}</p></main>`

let base = ''
let stop = (): void => {}
let app = ''

beforeAll(async () => {
    ;({ app, base, stop } = await serveApp(
        {
            'index.abide': PAGE,
            ...HANDLERS,
            'layout.abide': `<script server>
${APP}</script>
`,
            'lib/marks.server.ts': 'export const marks: string[] = []\n',
            'invoices/[id]/index.abide': WHERE,
        },
        // 27.8 — read by the spawned server: one that coerces, and one that will not.
        { ...process.env, LIMIT: '9', FEATURE: 'maybe' },
    ))
}, 30_000)

afterAll(() => {
    stop()
    removeTemporaryModules()
})

// 37.3, 16.14 — THE RUNGS RUN PRE-ROUTING, IN REGISTRATION ORDER, the first outermost. THE REVERT:
// fold the rungs in `compose` from the front rather than the back; the header reads `inner`
// rewritten by nothing, or `outer()` wrapping nothing, rather than `outer(inner)`.
test('middleware wraps every lane, first registered outermost — 37.3, 16.14', async () => {
    const page = await Bun.fetch(`${base}/`)
    expect(page.status).toBe(200)
    expect(page.headers.get('x-onion')).toBe('outer(inner)')
    // 21.10, 22.9 — a rung's write through `response` lands on the page it wrapped.
    expect(page.headers.get('x-rung')).toBe('outer')

    const answer = await Bun.fetch(`${base}/probe/seen`)
    expect(answer.headers.get('x-onion')).toBe('outer(inner)')
})

// 42.6 — ONE SCOPE PER REQUEST. A handler reads what the rung wrote through `response` in the same
// request, which it only can if the rpc lane did not open a second scope under the one `App.fetch`
// opened. THE REVERT: have `answerRpc` call `inScope` again; the handler answers "none".
test('a handler shares the scope the middleware ran in — 42.6', async () => {
    const answer = await Bun.fetch(`${base}/probe/seen`)
    expect(await answer.json()).toBe('outer')
})

// 42.6 — A RUNG THAT HANDS `next` A NEW REQUEST IS STILL IN THE ONE SCOPE: what the rung outside it
// wrote through `response` is read inside, what the handler writes reaches the answer, and `request`
// is the request the lane was handed. THE REVERT: in `answerRequest`, open a scope for a request that
// is not the scope's own (`inScope(request, …)`); the handler reads "none" and its cookies are lost.
test('a rung that rewrites the request stays in the scope App.fetch opened — 42.6, 37.3', async () => {
    const rewrite = { headers: { 'x-rewrite': '1' } }
    const seen = await Bun.fetch(`${base}/probe/seen`, rewrite)
    expect(await seen.json()).toBe('outer')
    const asked = await Bun.fetch(`${base}/probe/rewritten`, rewrite)
    expect(await asked.json()).toBe('by the rung')
    const remembered = await Bun.fetch(`${base}/probe/remember`, {
        method: 'POST',
        headers: { 'x-rewrite': '1' },
    })
    expect(remembered.headers.getSetCookie().length).toBe(2)
})

// 16.16 — a rung that never calls `next` is the answer.
test('a rung short-circuits by returning — 16.16', async () => {
    const answer = await Bun.fetch(`${base}/short`)
    expect(await answer.text()).toBe('short-circuited')
})

// 37.3 — A ROOT RUNG ANSWERS AN ADDRESS NO ROUTE DOES, inside the request scope; an address it
// passes on is still a 404.
test('a root rung answers where no route does, ahead of the 404 — 37.3', async () => {
    const own = await Bun.fetch(`${base}/own`)
    expect(own.status).toBe(200)
    expect(await own.text()).toBe('own route for GET')
    expect((await Bun.fetch(`${base}/nowhere`)).status).toBe(404)
})

// 37.5 — AN UNEXPECTED THROW IS A 500 and is handed to `onError`. The script below reads the mark.
test('an unexpected throw is answered 500 — 37.5', async () => {
    expect((await Bun.fetch(`${base}/explode`)).status).toBe(500)
})

// 42.16 — UNDER `bun test`, `createApp` BOOTS A BUILD OF THE SOURCES AS THEY STAND, and never one
// they did not make: an `abide build` left beside the app from before an edit is not it. THE REVERT:
// drop the `NODE_ENV` test from `createApp`; it boots the build beside the app, which says `before`.
test('createApp under bun test boots the sources as they stand, not a build left beside them — 42.16', async () => {
    const fresh = temporaryModule({
        'package.json': JSON.stringify({
            name: 'fixture',
            type: 'module',
            imports: { '#src/*': './src/*' },
        }),
        'src/index.abide': '<main><p id="fresh">before</p></main>',
        'host.test.ts': `import { expect, test } from 'bun:test'
import { createApp } from '@abide/abide/server'

test('boots', async () => {
    const app = await createApp()
    const page = await (await app.fetch(new Request('http://app.test/'))).text()
    await app.stop()
    expect(page).toContain('after')
}, 60_000)
`,
    })
    const built = await spawned(['bun', BIN, 'build', '--root', `${fresh}/src`])
    expect(built.exitCode).toBe(0)
    await Bun.write(
        `${fresh}/src/index.abide`,
        '<main><p id="fresh">after</p></main>',
    )
    const ran = await spawned(['bun', 'test', './host.test.ts'], { cwd: fresh })
    expect(`${ran.exitCode} ${ran.stderr.includes('1 pass')}`).toBe('0 true')
}, 90_000)

// 38.100 — AN APP NOBODY BUILT IS BUILT, by `abide start` and by `createApp` outside a test. THE
// REVERT: drop the `build` call from `serveBuild`, and `abide start` reports nothing to serve while
// `createApp` throws that it found nothing to build.
test('abide start and createApp build an app nobody built — 38.100', async () => {
    const fresh = temporaryModule({
        'package.json': JSON.stringify({
            name: 'fixture',
            type: 'module',
            imports: { '#src/*': './src/*' },
        }),
        'src/index.abide': '<main><p id="unbuilt">never built</p></main>',
        'host.ts': `import { createApp } from '@abide/abide/server'

const app = await createApp()
const page = await (await app.fetch(new Request('http://app.test/'))).text()
await app.stop()
console.log(JSON.stringify(page.includes('never built')))
`,
    })
    const started = await startApp(
        `${fresh}/src`,
        process.env,
        `${fresh}/.abide`,
    )
    try {
        expect(await (await Bun.fetch(`${started.base}/`)).text()).toContain(
            'never built',
        )
    } finally {
        started.stop()
    }
    await spawned(['rm', '-rf', `${fresh}/.abide`])
    expect(
        await lastLinePrinted<boolean>(['bun', `${fresh}/host.ts`], {
            cwd: fresh,
            env: { ...process.env, NODE_ENV: 'production' },
        }),
    ).toBe(true)
}, 90_000)

// 12.5 — A RENDER'S WATCHES STOP WHEN ITS REQUEST IS ANSWERED. The page's setup opens a watch over
// a global value; two requests render it, and a write after both wakes nothing. Left running, every
// render's watch stayed subscribed for the life of the process. THE REVERT: drop the
// `releaseScope` in `App.fetch` — the write wakes the dead renders, `runs` 3 where 2 are due.
test("a page's watch stops when the request that rendered it is answered — 12.5", async () => {
    const fresh = appFixture({
        'index.abide': `<script module>
import { reactive } from '@abide/abide'

const level = reactive(0, { global: true })
;(globalThis as { bump?: () => void }).bump = () => level.set(level.peek() + 1)
</script>

<script>
import { watch } from '@abide/abide'

const tally = ((globalThis as { tally?: { runs: number; disposed: number } }).tally ??= { runs: 0, disposed: 0 })
watch(() => {
    level()
    tally.runs += 1
    return () => {
        tally.disposed += 1
    }
})
</script>

<main>page</main>`,
        'tests/host.test.ts': `import { expect, test } from 'bun:test'
import { flushSync } from '@abide/abide'
import { createApp } from '@abide/abide/server'

test('renders twice', async () => {
    const app = await createApp()
    for (const _ of [1, 2]) await (await app.fetch(new Request('http://app.test/'))).text()
    ;(globalThis as { bump?: () => void }).bump?.()
    flushSync()
    await app.stop()
    expect((globalThis as { tally?: unknown }).tally).toEqual({ runs: 2, disposed: 2 })
}, 60_000)
`,
    })
    const ran = await spawned(['bun', 'test', './tests/host.test.ts'], {
        cwd: fresh,
    })
    expect(`${ran.exitCode} ${ran.stderr.includes('1 pass')}`, ran.stderr).toBe(
        '0 true',
    )
}, 90_000)

// 42.5, 42.7, 42.8, 37.4, 37.5 — `createApp` IN PROCESS, with no socket. The script is the host.
//
// 17.8 — IN PROCESS IS WHERE A REASON PHRASE IS OURS TO GIVE: over a socket bun writes one into the
// status line itself, but a `Response` handed straight back reads '' until `stamp` names it. THE
// REVERT: drop the `statusText` default from `stamp`; `exploded` reads '500 '.
test('createApp boots inside onStart, answers with no socket, and stops inside onStop — 42, 37.4, 17.8', async () => {
    await Bun.write(
        `${app}/lib/host.ts`,
        `import { createApp, request } from '@abide/abide/server'
import { marks } from './marks.server.ts'

const app = await createApp()
const own = await app.fetch(new Request('http://app.test/own', { method: 'POST' }))
const exploded = await app.fetch(new Request('http://app.test/explode'))
const inRequest = await app.run(() => request().url, { request: new Request('http://app.test/x') })
let outside = ''
try {
    await app.run(() => request())
} catch (thrown) {
    outside = (thrown as Error).message.includes('22.1') ? 'threw' : 'wrong throw'
}
await app.stop()
console.log(JSON.stringify({ own: await own.text(), exploded: \`\${exploded.status} \${exploded.statusText}\`, inRequest, outside, marks }))
`,
    )
    expect(
        await lastLinePrinted<Record<string, unknown>>(
            ['bun', `${app}/lib/host.ts`],
            { cwd: app },
        ),
    ).toEqual({
        own: 'own route for POST',
        exploded: '500 Internal Server Error',
        inRequest: 'http://app.test/x',
        outside: 'threw',
        marks: [
            'before start',
            'after start',
            'error: the app route blew up',
            'stopped',
        ],
    })
}, 30_000)

// 42.14 — `await using` STOPS THE APP where its block ends, through `stop` itself. THE REVERT: drop
// `[Symbol.asyncDispose]` from the `App` `createApp` returns; `await using` throws a TypeError at
// the declaration and the script exits non-zero.
test('an App held by await using stops when its block ends — 42.14', async () => {
    await Bun.write(
        `${app}/lib/disposed.ts`,
        `import { createApp } from '@abide/abide/server'
import { marks } from './marks.server.ts'

{
    await using held = await createApp()
    marks.push(held[Symbol.asyncDispose] === held.stop ? 'held' : 'a second stop')
}
console.log(JSON.stringify(marks))
`,
    )
    expect(
        await lastLinePrinted<string[]>(['bun', `${app}/lib/disposed.ts`], {
            cwd: app,
        }),
    ).toEqual(['before start', 'after start', 'held', 'stopped'])
}, 30_000)

// 37.6 — A THROWING `onStart` FAILS HARD: `abide start` exits rather than serving. THE REVERT: catch
// around `compose(HOOKS.starts, …)` in `bootApp`; the command prints an address and serves.
test('a throwing onStart stops the server starting — 37.6', async () => {
    const broken = appFixture({
        'index.abide': PAGE,
        'layout.abide': `<script server>
import { onStart } from '@abide/abide/server'\n\nonStart(async () => {\n    throw new Error('no database')\n})\n</script>
`,
    })
    expect((await buildApp(broken)).exitCode).toBe(0)
    const started = await spawned([
        'bun',
        new URL('../bin/abide.ts', import.meta.url).pathname,
        'start',
        '--root',
        broken,
        '--out',
        `${broken}/.abide`,
        '--port',
        '0',
    ])
    expect(started.exitCode).not.toBe(0)
    expect(started.stderr).toContain('no database')
    expect(started.stdout).not.toContain('http://')
}, 30_000)

const CALLER_TRACE = '4bf92f3577b34da6a3ce929d0e0e4736'

// 24.1, 24.2, 24.5, 21.2 — THE CALLER'S TRACE IS ADOPTED, its sampling flag carried verbatim, and
// an outbound `traceparent` inside a span names THAT span as the parent — not the caller's, and
// not the request's own, which is what `traceresponse` names. THE REVERT: have `trace.headers` name
// `traceOf(scope).span` rather than `currentSpan(scope)`; the parent equals the response's span.
test('a traceparent is adopted and a span is the parent of what goes out — 24, 21.2', async () => {
    const answer = await Bun.fetch(`${base}/probe/traced`, {
        headers: { traceparent: `00-${CALLER_TRACE}-00f067aa0ba902b7-01` },
    })
    const body = (await answer.json()) as {
        id: string
        sampled: boolean
        parent: string
    }
    expect(body.id).toBe(CALLER_TRACE)
    expect(body.sampled).toBe(true)
    const responded = answer.headers.get('traceresponse') as string
    const [, respondedTrace, respondedSpan] = responded.split('-')
    const [, parentTrace, parentSpan, flags] = body.parent.split('-')
    expect(respondedTrace).toBe(CALLER_TRACE)
    expect(parentTrace).toBe(CALLER_TRACE)
    expect(flags).toBe('01')
    expect(parentSpan).not.toBe('00f067aa0ba902b7')
    expect(parentSpan).not.toBe(respondedSpan)
})

// 21.1, 21.2, 21.6 — EVERY ANSWER, a 404 and the bundle included; the referrer policy on a page.
test('every answer carries nosniff and traceresponse; a page its referrer policy — 21.1, 21.2, 21.6', async () => {
    for (const path of [
        '/',
        '/nowhere',
        '/probe/seen',
        '/__abide/client/none.js',
    ]) {
        const answer = await Bun.fetch(`${base}${path}`)
        expect(`${path} ${answer.headers.get('x-content-type-options')}`).toBe(
            `${path} nosniff`,
        )
        expect(answer.headers.get('traceresponse')).toMatch(
            /^00-[0-9a-f]{32}-[0-9a-f]{16}-00$/,
        )
    }
    const page = await Bun.fetch(`${base}/`)
    expect(page.headers.get('referrer-policy')).toBe(
        'strict-origin-when-cross-origin',
    )
    expect(page.headers.get('cache-control')).toBe('private, no-store')
})

// 21.18 — a page may not be framed unless the app says so. THE REVERT: drop the
// `content-security-policy` default from `DOCUMENT_HEADERS`; the header reads null.
test('a page may not be framed by default — 21.18', async () => {
    const page = await Bun.fetch(`${base}/`)
    expect(page.headers.get('content-security-policy')).toBe(
        "frame-ancestors 'none'",
    )
})

// 21.3 — A REFUSAL ABIDE ANSWERS AS TEXT is typed as text and uncached, through `stamp`'s rebuild
// for its reason phrase. THE REVERT: `notFound` as a bare `new Response('not found', …)`; the type
// reads `application/octet-stream`, which `nosniff` turns into a download, and `cache-control` null.
test('a refusal answered as text is typed and uncached — 21.3', async () => {
    const answer = await Bun.fetch(`${base}/__abide/client/none.js`)
    expect(answer.status).toBe(404)
    expect(answer.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(answer.headers.get('cache-control')).toBe('private, no-store')
})

// 30.15, 30.16 — THE CLIENT ROUTER ASKING runs `middleware` and not the render: a go-ahead is a
// bodiless 204, and what a rung wrote or answered stands in its place. THE REVERT: drop the
// `NAVIGATION_HEADER` branch in `answerRequest`; the go-ahead reads 200 with the page's markup.
test('a navigation passes through middleware and is not rendered — 30.15, 30.16', async () => {
    const ask = (path: string) =>
        Bun.fetch(`${base}${path}`, {
            headers: { 'abide-navigation': '1' },
            redirect: 'manual',
        })
    const allowed = await ask('/invoices/42')
    expect(allowed.status).toBe(204)
    expect(await allowed.text()).toBe('')
    expect(allowed.headers.get('cache-control')).toBe('no-store')
    const moved = await ask('/invoices/moved')
    expect(moved.status).toBe(302)
    expect(moved.headers.get('location')).toBe('/invoices/42')
    expect((await ask('/invoices/refused')).status).toBe(403)
})

// 23.1, 23.2, 23.6, 23.8 — THE PAGE LANE FILLS `route` before the page's setup runs, in the request's
// own instances, so two requests for two invoices each render their own. THE REVERT: build the four
// members with `reactive` rather than `ambient`; `answerRequest` imports `route.ts` before the
// provider is installed, the members are one per process, and the first request renders invoice 7.
test('a server-rendered page reads route and online — 23.1, 23.8', async () => {
    const [first, second] = await Promise.all([
        Bun.fetch(`${base}/invoices/42`).then((answer) => answer.text()),
        Bun.fetch(`${base}/invoices/7`).then((answer) => answer.text()),
    ])
    expect(first).toContain('/invoices/[id]|42|/invoices/42|false|true')
    expect(second).toContain('/invoices/[id]|7|/invoices/7|false|true')
})

// 31.16 — `route`'s FOUR VALUES ARE READ BY NAME, each as a name bound to a `Reactive` is: a member
// after one reaches the value. THE REVERT: drop `routeReads` from the classify pass; `route.name`
// is handed on as the `Reactive`, `toUpperCase` is not a member of one, and the page answers 500.
test('route.name, params, url and navigating are read by name — 31.16', async () => {
    const page = await (await Bun.fetch(`${base}/invoices/42`)).text()
    expect(page).toContain('/INVOICES/[ID]|42|/invoices/42|still')
})

// 22.2, 22.3 — THE REQUEST'S COOKIES, READ AND WRITTEN, the writes collected onto the answer as one
// `set-cookie` each. THE REVERT: merge the written headers with `set` rather than `append` in
// `applyWritten`; the answer carries 1 cookie of the 2 the handler wrote.
test('cookies reads the request and writes onto the response — 22.2, 22.3', async () => {
    const answer = await Bun.fetch(`${base}/probe/remember`, {
        method: 'POST',
        headers: { cookie: 'theme=dark; other=x' },
    })
    expect(await answer.json()).toBe('dark')
    const written = answer.headers.getSetCookie()
    expect(written).toHaveLength(2)
    expect(written[0]).toBe('seen=1; Path=/; SameSite=Lax')
    expect(written[1]).toBe('session=abc; Path=/; HttpOnly; SameSite=Lax')
})

// 22.9 — A LANE THAT BUILT ITS OWN `Response` still carries what was written: a root rung's.
test('a cookie written in a rung that answers reaches its answer — 22.9', async () => {
    const answer = await Bun.fetch(`${base}/own-cookie`)
    expect(answer.headers.getSetCookie()).toEqual([
        'from=own; Path=/; SameSite=Lax',
    ])
})

// 27.2, 27.3, 27.8 — THE ENVIRONMENT WINS OVER THE APP'S DEFAULTS, coerced to the default's type, and
// a value that will not coerce leaves the default standing; the name is derived from the app's
// `package.json`. THE REVERT: return `text` from `coerce` whatever the default's type; the limit
// arrives as "9" and the feature as "maybe".
test('config layers derived, onConfig and the environment — 27.2, 27.3, 27.8', async () => {
    const answer = await Bun.fetch(`${base}/probe/settings`)
    expect(await answer.json()).toEqual({
        limit: 9,
        feature: false,
        label: 'default',
        name: 'fixture',
        dataDir: true,
    })
})

// 25.1, 25.2, 21.3 — THE ACCOUNT, with the app's own fields winning each collision, never cached.
test('/__abide/health answers the account, the app winning collisions — 25.1, 25.2, 21.3', async () => {
    const answer = await Bun.fetch(`${base}/__abide/health`)
    // Answered as a handler's is (25.3), so with a handler's spelling of it.
    expect(answer.headers.get('cache-control')).toBe('private, no-store')
    // A load balancer is no caller: the check hands it no cookie to keep.
    expect(answer.headers.get('set-cookie')).toBeNull()
    const account = (await answer.json()) as Record<string, string>
    expect(account.version).toBe('the app wins')
    expect(account.db).toBe('up')
    expect(account.abide).toBe(abidePackage.version)
    expect(Number.isNaN(Date.parse(account.startedAt as string))).toBe(false)
})
