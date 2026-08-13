// The example, as an app: what `abide start` boots.
//
// This is the whole of it. There is no `Bun.serve`, no `dispatch` to mount, no request scope, no
// signal handler, no route matching, no document, and not one `import './server/rpc/…'` for its side
// effect — `pages/` is what this app serves, `server/rpc` and `server/sockets` are what it answers,
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
import { META } from './demos/SUITES.ts'

/**
 * The paths the pages directory cannot answer for itself.
 *
 * Each section is one page for nineteen capabilities, and a parameter matches anything — so
 * `/docs/nonsense` matches and would be served as a 200 with an apology on it. What is wrong about it is
 * something only the APP knows, which is exactly what `export default` is for: it is asked before the
 * pages, and `undefined` is how it hands the path back to them.
 *
 * The pages still render their own "nothing here" for the same case, and that is not a duplicate: a
 * client that NAVIGATES there never asks this server anything.
 */
export default function notFound(): Response | undefined {
    const asked = route()
    if (!SUITE_ROUTES.has(asked.name)) return undefined
    const name = asked.params.suite as string
    if (Object.hasOwn(META, name)) return undefined
    return new Response(`no suite named ${name}\n`, {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
}

/**
 * The three patterns a `[suite]` parameter appears in — a route's NAME is its pattern.
 *
 * Three because there are three VIEWS of a capability: written down, running, and priced. Enumerated
 * rather than matched on a prefix, so a route added under one of these sections is a name this does not
 * claim to know about until somebody puts it here.
 */
const SUITE_ROUTES = new Set(['/docs/[suite]', '/tests/[suite]/[...rest]', '/bench/[suite]'])

/**
 * One rung, and what a rung is for: it sees the request going down and the response coming back.
 *
 * An array because a chain is plural — `abide start` hands the whole of it to `middleware(...)`, in
 * this order, outermost first.
 */
export const middleware: Middleware[] = [
    async (next) => {
        const answered = await next()
        answered.headers.set('x-example', 'served')
        return answered
    },
    // The policy, at its default. This app is the reason to have it here rather than only in a test:
    // the pages suspend, stream and load routes through `import()` long after hydration, so a nonce
    // that reached the markup but not a later `adopt()` shows up as an unstyled card rather than as
    // a failing assertion. `style-src-attr` stays at its baseline because the demo furniture computes
    // widths at runtime, which is what a `style=` is for.
    csp(),
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
