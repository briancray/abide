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
// Every export below is optional. An app that wants none of them is an empty file, and an app that
// wants a route of its own adds `export default` beside these — it is asked first, and `undefined` is
// how it hands a path back to the pages.

import { log, route } from 'abide'
import { csp, type Middleware } from 'abide/server'
import { CALLABLES } from '#shared/demos/CALLABLES.ts'
import { SPELLINGS } from '#shared/demos/SPELLINGS.ts'
import { META } from '#shared/demos/SUITES.ts'

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
 * THREE vocabularies, which is the shape of the site rather than an accident: `/docs` is keyed by the
 * callable you import AND by the spelling you type, and `/tests` and `/bench` by the capability whose
 * cases run and are priced. A suite is not an address under `/docs` and a callable is not one under
 * `/bench`, so asking one list about another would 404 a third of the site.
 *
 * Enumerated rather than matched on a prefix, so a route added under one of these sections is a name
 * this does not claim to know about until somebody puts it here.
 */
const PARAMETERISED = new Map<string, { parameter: string; kind: string; known: object }>([
    ['/docs/[callable]', { parameter: 'callable', kind: 'callable', known: CALLABLES }],
    ['/docs/syntax/[spelling]', { parameter: 'spelling', kind: 'spelling', known: SPELLINGS }],
    ['/tests/[suite]/[...rest]', { parameter: 'suite', kind: 'suite', known: META }],
    ['/bench/[suite]', { parameter: 'suite', kind: 'suite', known: META }],
])

/**
 * One rung, and what a rung is for: it sees the request going down and the response coming back.
 *
 * An array because a chain is plural — `abide start` hands the whole of it to `middleware(...)`, in
 * this order, outermost first.
 */
export const middleware: Middleware[] = [
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
]

/** WRAPS the bind: everything before `start()` happens before the socket exists. */
export async function onStart(start: () => Promise<void>): Promise<void> {
    log('warming')
    await start()
}

/** And mirrors it on the way out. `stop()` is the socket closing. */
export async function onStop(stop: () => Promise<void>): Promise<void> {
    log('draining')
    await stop()
}

/** Fields merged OVER the baseline `{ reachable, version, startedAt, uptime }`. */
export function onHealth(): unknown {
    return { example: { serving: true } }
}

// The three hooks below exist so that the `/docs` rungs about them have a RUNNING one to point at.
// Every rung's preview presses a button against this process, and a hook nothing registered is a rung
// whose preview would have to describe what would have happened — which is the thing the previews
// replaced. They are app EXPORTS rather than calls made from a demo module on purpose: one process has
// one answer to each of these, so a second registration replaces the first, and the boot is the single
// place that should make it.

/** The middle layer — under the environment, which is what makes it a default rather than a knob. */
export function onConfig(): Record<string, unknown> {
    return { DOCS_GREETING: 'hello' }
}

/** What an unexpected failure means here. `undefined` falls through to abide's own answer. */
export function onError(thrown: unknown): Response | undefined {
    if (thrown instanceof RangeError) return new Response('that number is out of range', { status: 400 })
    return undefined
}

/**
 * What the sealed claims MEAN — the cookie carries an id and the principal carries a row.
 *
 * Anonymous is left exactly as it was: a caller with no seal reaches here with `null`, and merging
 * nothing over the floor is how this app says it has nothing to add about somebody it does not know.
 */
export function onIdentity(claims: unknown): unknown {
    const { id } = (claims ?? {}) as { id?: string }
    if (id === undefined) return {}
    return { name: `user ${id}`, roles: ['reader'] }
}
