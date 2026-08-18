// The dogfood app: what `abide start` boots.
//
// This is the whole of it. There is no `Bun.serve`, no `dispatch` to mount, no request scope, no
// signal handler, no route matching, no document, and not one `import './rpc/…'` for its side
// effect — `#ui/pages/` is what this app serves, `#server/rpc` and `#server/sockets` are what it answers,
// `app.html` is what it is served in, and `client.ts` is the lane the browser gets. Each of those is
// decided by where a file SITS, so the boot finds them. What is left here is the part that is
// genuinely this app's: what wraps a request, what happens around the boot, and what it says about
// its own health.
//
// Every registration below is optional. An app that wants none of them is an empty file, and an app
// that wants a route of its own adds `export default` beside them — it is asked first, and
// `undefined` is how it hands a path back to the pages. The route is the only EXPORT the boot reads,
// because a route is the only one of these with no call to make: the rest are registrations, made
// here at module scope and checked against their own types by this app's typecheck.

import { log, route } from 'abide'
import { csp, middleware, onConfig, onError, onHealth, onIdentity, onStart, onStop } from 'abide/server'
import { exportSpans } from '#server/lib/otlp.ts'
import { CALLABLES } from '#shared/demos/CALLABLES.ts'
import { SPELLINGS } from '#shared/demos/SPELLINGS.ts'
import { META } from '#shared/demos/SUITES.ts'
import { USECASES_BY_NAME } from '#shared/demos/usecases/USECASES.ts'

/**
 * The paths the pages directory cannot answer for itself.
 *
 * Each section is one page for many names, and a parameter matches anything — so `/docs/nonsense`
 * matches and would be served as a 200 with an apology on it. What is wrong about it is something only
 * the APP knows, which is exactly what `export default` is for: it is asked before the pages, and
 * `undefined` is how it hands the path back to them.
 *
 * The pages still render their own "nothing here" for the same case, and that is not a duplicate: a
 * client that NAVIGATES there never asks this server anything.
 */
export default function notFound(): Response | undefined {
    const asked = route()
    const parameterised = PARAMETERISED.get(asked.name)
    if (parameterised === undefined) return undefined
    const name = asked.params[parameterised.parameter] as string
    if (Object.hasOwn(parameterised.known, name)) return undefined
    return new Response(`no ${parameterised.kind} named ${name}\n`, {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
}

/**
 * The patterns whose one segment is a NAME, and the vocabulary each is a name from — a route's NAME is
 * its pattern.
 *
 * FOUR vocabularies, which is the shape of the site rather than an accident: `/docs` is keyed by the
 * callable you import AND by the spelling you type, `/tests` and `/bench` by the capability whose
 * cases run and are priced, and `/demos` by the use case a whole page at scale is one of. A suite is
 * not an address under `/docs` and a callable is not one under `/bench`, so asking one list about
 * another would 404 a quarter of the site.
 *
 * Enumerated rather than matched on a prefix, so a route added under one of these sections is a name
 * this does not claim to know about until somebody puts it here.
 */
const PARAMETERISED = new Map<string, { parameter: string; kind: string; known: object }>([
    ['/docs/[callable]', { parameter: 'callable', kind: 'callable', known: CALLABLES }],
    ['/docs/syntax/[spelling]', { parameter: 'spelling', kind: 'spelling', known: SPELLINGS }],
    ['/tests/[suite]/[...rest]', { parameter: 'suite', kind: 'suite', known: META }],
    ['/bench/[suite]', { parameter: 'suite', kind: 'suite', known: META }],
    // The LEAF, not `VIEWS` or `SOURCES` — the three are gated key-for-key against each other in
    // `#tests/unit/usecases.test.ts`, so all three answer this, and only one of them costs nothing to
    // ask. `VIEWS` lands on six compiled views and, through them, on the browser's mount runtime.
    ['/demos/[name]', { parameter: 'name', kind: 'use case', known: USECASES_BY_NAME }],
])

/**
 * One rung, and what a rung is for: it sees the request going down and the response coming back.
 *
 * Variadic because a chain is plural, and in this order — outermost first. The one registration that
 * APPENDS rather than replaces, which is why it keeps its own name instead of an `onRequest` that
 * would read as a point in time and as one answer per process.
 */
middleware(
    // Outermost, so the span it times covers every rung under it and the route itself. The rung about
    // it is `/docs/trace`'s last, and this is the one it points at.
    exportSpans,
    async (next) => {
        const answered = await next()
        answered.headers.set('x-dogfood', 'served')
        return answered
    },
    // The policy, at its default but for one directive. This app is the reason to have it here rather
    // than only in a test: the pages suspend, stream and load routes through `import()` long after
    // hydration, so a nonce that reached the markup but not a later `adopt()` shows up as an unstyled
    // card rather than as a failing assertion. `style-src-attr` stays at its baseline because the demo
    // furniture computes widths at runtime, which is what a `style=` is for.
    //
    // `frame-ancestors` moves from `'none'` to `'self'`, and it is a capability this app needs rather
    // than a test being accommodated: an app whose job is to DEMONSTRATE itself has to be able to show
    // one of its own pages inside another — a `visit` case frames a real route and asserts what the
    // response did, which is the only way to watch a served page patch its deferred region in for
    // real. `'self'` is the narrowest form of that: same origin only, and every other origin is still
    // refused exactly as before.
    csp({ 'frame-ancestors': ["'self'"] }),
)

/** WRAPS the bind: everything before `start()` happens before the socket exists. */
onStart(async (start) => {
    log('warming')
    await start()
})

/** And mirrors it on the way out. `stop()` is the socket closing. */
onStop(async (stop) => {
    log('draining')
    await stop()
})

/** Fields merged OVER the baseline `{ reachable, version, startedAt, uptime }`. */
onHealth(() => ({ example: { serving: true } }))

// The three hooks below exist so that the `/docs` rungs about them have a RUNNING one to point at.
// Every rung's preview presses a button against this process, and a hook nothing registered is a rung
// whose preview would have to describe what would have happened — which is the thing the previews
// replaced. They are registered HERE rather than from a demo module on purpose: one process has one
// answer to each of these, so a second registration replaces the first, and the boot is the single
// place that should make it.

/** The middle layer — under the environment, which is what makes it a default rather than a knob. */
onConfig(() => ({ DOCS_GREETING: 'hello' }))

/** What an unexpected failure means here. `undefined` falls through to abide's own answer. */
onError((thrown) => {
    if (thrown instanceof RangeError) return new Response('that number is out of range', { status: 400 })
    return undefined
})

/**
 * What the sealed claims MEAN — the cookie carries an id and the principal carries a row.
 *
 * Anonymous is left exactly as it was: a caller with no seal reaches here with `null`, and merging
 * nothing over the floor is how this app says it has nothing to add about somebody it does not know.
 */
onIdentity((claims) => {
    const { id } = (claims ?? {}) as { id?: string }
    if (id === undefined) return {}
    return { name: `user ${id}`, roles: ['reader'] }
})
