// SECTIONS 37 AND 42 — the lifecycle hooks an `src/server/app.ts` calls, and the `App` they wrap.
// Served by `abide start`, and held in process by a script calling `createApp` — both spawned, for
// `serve.test.ts`'s reason: happy-dom's preload clobbers `Response`.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { appFixture, buildApp, serveApp } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

const PAGE = `<main><h1>home</h1></main>`

const HANDLERS = `import { config, cookies, GET, POST, request, response, trace } from 'abide/server'

export const settings = GET(() => {
    const resolved = config()
    return {
        limit: resolved.LIMIT,
        feature: resolved.FEATURE,
        label: resolved.LABEL,
        name: resolved.APP_NAME,
        dataDir: String(resolved.APP_DATA_DIR).endsWith('/fixture'),
    }
})

export const remember = POST(() => {
    const theme = cookies().get('theme')
    cookies().set('seen', '1')
    cookies().set('session', 'abc', { httpOnly: true })
    return theme
})

export const seen = GET(() => response().headers.get('x-rung') ?? 'none')

export const rewritten = GET(() => request().headers.get('x-rewritten') ?? 'the original')

export const traced = GET(() =>
    trace.span('lookup', () => ({
        id: trace(),
        sampled: trace.sampled(),
        parent: trace.headers().traceparent,
    })),
)
`

// Every hook, each leaving a mark a request or a script can read back.
const APP = `import { cookies, middleware, onConfig, onError, onHealth, onStart, onStop, redirect, request, response } from 'abide/server'

onConfig(() => ({ LIMIT: 5, FEATURE: false, LABEL: 'default' }))
onHealth(() => ({ db: 'up', version: 'the app wins' }))

export const marks: string[] = []

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
    // 16.17 — a rung that answers in the route's place.
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

export default (asked: Request) => {
    const path = new URL(asked.url).pathname
    if (path === '/own') return new Response(\`own route for \${request().method}\`)
    if (path === '/own-cookie') {
        cookies().set('from', 'own')
        return new Response('set')
    }
    if (path === '/explode') throw new Error('the app route blew up')
    return undefined
}
`

// 23.1 — A PAGE READS WHERE IT IS off `route`, and `online` answers true on a server (23.8).
const WHERE = `<script>
import { online, route } from 'abide'
</script>

<main><p id="where">{route.name()}|{route.params().id}|{route.url().pathname}|{route.navigating()}|{online()}</p></main>`

let base = ''
let stop = (): void => {}
let app = ''

beforeAll(async () => {
    // 27.8 — read by the spawned server: one that coerces, and one that will not.
    process.env.LIMIT = '9'
    process.env.FEATURE = 'maybe'
    ;({ app, base, stop } = await serveApp({
        'ui/pages/page.abide': PAGE,
        'server/rpc/probe.ts': HANDLERS,
        'server/app.ts': APP,
        'ui/pages/invoices/[id]/page.abide': WHERE,
    }))
}, 30_000)

afterAll(() => {
    stop()
    removeTemporaryModules()
})

// 37.3, 16.15 — THE RUNGS RUN PRE-ROUTING, IN REGISTRATION ORDER, the first outermost. THE REVERT:
// fold the rungs in `compose` from the front rather than the back; the header reads `inner`
// rewritten by nothing, or `outer()` wrapping nothing, rather than `outer(inner)`.
test('middleware wraps every lane, first registered outermost — 37.3, 16.15', async () => {
    const page = await Bun.fetch(`${base}/`)
    expect(page.status).toBe(200)
    expect(page.headers.get('x-onion')).toBe('outer(inner)')
    // 21.10, 22.9 — a rung's write through `response` lands on the page it wrapped.
    expect(page.headers.get('x-rung')).toBe('outer')

    const answer = await Bun.fetch(`${base}/__abide/rpc/probe/seen`)
    expect(answer.headers.get('x-onion')).toBe('outer(inner)')
})

// 42.6 — ONE SCOPE PER REQUEST. A handler reads what the rung wrote through `response` in the same
// request, which it only can if the rpc lane did not open a second scope under the one `App.fetch`
// opened. THE REVERT: have `answerRpc` call `inScope` again; the handler answers "none".
test('a handler shares the scope the middleware ran in — 42.6', async () => {
    const answer = await Bun.fetch(`${base}/__abide/rpc/probe/seen`)
    expect(await answer.json()).toBe('outer')
})

// 42.6 — A RUNG THAT HANDS `next` A NEW REQUEST IS STILL IN THE ONE SCOPE: what the rung outside it
// wrote through `response` is read inside, what the handler writes reaches the answer, and `request`
// is the request the lane was handed. THE REVERT: in `answerRequest`, open a scope for a request that
// is not the scope's own (`inScope(request, …)`); the handler reads "none" and its cookies are lost.
test('a rung that rewrites the request stays in the scope App.fetch opened — 42.6, 37.3', async () => {
    const rewrite = { headers: { 'x-rewrite': '1' } }
    const seen = await Bun.fetch(`${base}/__abide/rpc/probe/seen`, rewrite)
    expect(await seen.json()).toBe('outer')
    const asked = await Bun.fetch(
        `${base}/__abide/rpc/probe/rewritten`,
        rewrite,
    )
    expect(await asked.json()).toBe('by the rung')
    const remembered = await Bun.fetch(`${base}/__abide/rpc/probe/remember`, {
        method: 'POST',
        headers: { 'x-rewrite': '1' },
    })
    expect(remembered.headers.getSetCookie().length).toBe(2)
})

// 16.17 — a rung that never calls `next` is the answer.
test('a rung short-circuits by returning — 16.17', async () => {
    const answer = await Bun.fetch(`${base}/short`)
    expect(await answer.text()).toBe('short-circuited')
})

// 37.2 — THE APP'S OWN ROUTE answers where nothing of abide's does, inside the request scope; an
// address it declines is still a 404.
test('the default export is the app route, asked before the 404 — 37.2', async () => {
    const own = await Bun.fetch(`${base}/own`)
    expect(own.status).toBe(200)
    expect(await own.text()).toBe('own route for GET')
    expect((await Bun.fetch(`${base}/nowhere`)).status).toBe(404)
})

// 37.5 — AN UNEXPECTED THROW IS A 500 and is handed to `onError`. The script below reads the mark.
test('an unexpected throw is answered 500 — 37.5', async () => {
    expect((await Bun.fetch(`${base}/explode`)).status).toBe(500)
})

// 42.5, 42.7, 42.8, 37.4, 37.5 — `createApp` IN PROCESS, with no socket. The script is the host.
test('createApp boots inside onStart, answers with no socket, and stops inside onStop — 42, 37.4', async () => {
    await Bun.write(
        `${app}/host.ts`,
        `import { createApp, request } from 'abide/server'
import { marks } from './server/app.ts'

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
console.log(JSON.stringify({ own: await own.text(), exploded: exploded.status, inRequest, outside, marks }))
`,
    )
    const ran = Bun.spawnSync(['bun', `${app}/host.ts`], { cwd: app })
    const printed = ran.stdout.toString().trim().split('\n').at(-1) as string
    expect(ran.exitCode).toBe(0)
    expect(JSON.parse(printed)).toEqual({
        own: 'own route for POST',
        exploded: 500,
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

// 37.6 — A THROWING `onStart` FAILS HARD: `abide start` exits rather than serving. THE REVERT: catch
// around `compose(HOOKS.starts, …)` in `bootApp`; the command prints an address and serves.
test('a throwing onStart stops the server starting — 37.6', async () => {
    const broken = appFixture({
        'ui/pages/page.abide': PAGE,
        'server/app.ts': `import { onStart } from 'abide/server'\n\nonStart(async () => {\n    throw new Error('no database')\n})\n`,
    })
    expect(buildApp(broken).exitCode).toBe(0)
    const started = Bun.spawnSync([
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
    expect(started.stderr.toString()).toContain('no database')
    expect(started.stdout.toString()).not.toContain('http://')
}, 30_000)

const CALLER_TRACE = '4bf92f3577b34da6a3ce929d0e0e4736'

// 24.1, 24.2, 24.5, 21.2 — THE CALLER'S TRACE IS ADOPTED, its sampling flag carried verbatim, and
// an outbound `traceparent` inside a span names THAT span as the parent — not the caller's, and
// not the request's own, which is what `traceresponse` names. THE REVERT: have `trace.headers` name
// `traceOf(scope).span` rather than `currentSpan(scope)`; the parent equals the response's span.
test('a traceparent is adopted and a span is the parent of what goes out — 24, 21.2', async () => {
    const answer = await Bun.fetch(`${base}/__abide/rpc/probe/traced`, {
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
        '/__abide/rpc/probe/seen',
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

// 22.2, 22.3 — THE REQUEST'S COOKIES, READ AND WRITTEN, the writes collected onto the answer as one
// `set-cookie` each. THE REVERT: merge the written headers with `set` rather than `append` in
// `applyWritten`; the answer carries 1 cookie of the 2 the handler wrote.
test('cookies reads the request and writes onto the response — 22.2, 22.3', async () => {
    const answer = await Bun.fetch(`${base}/__abide/rpc/probe/remember`, {
        method: 'POST',
        headers: { cookie: 'theme=dark; other=x' },
    })
    expect(await answer.json()).toBe('dark')
    const written = answer.headers.getSetCookie()
    expect(written).toHaveLength(2)
    expect(written[0]).toBe('seen=1; Path=/; SameSite=Lax')
    expect(written[1]).toBe('session=abc; Path=/; HttpOnly; SameSite=Lax')
})

// 22.9 — A LANE THAT BUILT ITS OWN `Response` still carries what was written: the app's own route.
test("a cookie written in the app's own route reaches its answer — 22.9", async () => {
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
    const answer = await Bun.fetch(`${base}/__abide/rpc/probe/settings`)
    expect(await answer.json()).toEqual({
        limit: 9,
        feature: false,
        label: 'default',
        name: 'fixture',
        dataDir: true,
    })
})

// 25.1, 25.2, 21.4 — THE ACCOUNT, with the app's own fields winning each collision, never cached.
test('/__abide/health answers the account, the app winning collisions — 25.1, 25.2, 21.4', async () => {
    const answer = await Bun.fetch(`${base}/__abide/health`)
    expect(answer.headers.get('cache-control')).toBe('no-store')
    const account = (await answer.json()) as Record<string, string>
    expect(account.version).toBe('the app wins')
    expect(account.db).toBe('up')
    expect(account.abide).toBe('0.0.0')
    expect(Number.isNaN(Date.parse(account.startedAt as string))).toBe(false)
})

// 36.7 — A GENERATED SURFACE IS CLOSED BY DEFAULT, and a closed one is a 404.
test('the generated surfaces are closed unless opened — 36.7', async () => {
    for (const path of ['/__abide/openapi.json', '/__abide/logs'])
        expect(`${path} ${(await Bun.fetch(`${base}${path}`)).status}`).toBe(
            `${path} 404`,
        )
    const mcp = await Bun.fetch(`${base}/__abide/mcp`, {
        method: 'POST',
        body: '{}',
    })
    expect(mcp.status).toBe(404)
})
