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

import { log } from 'abide'
import type { Middleware } from 'abide/server'

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
