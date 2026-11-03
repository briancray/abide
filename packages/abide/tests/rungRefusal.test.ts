// 37.14, 37.15 — A REFUSAL A `middleware` RUNG RETURNS IS ANSWERED IN ITS LANE, and one rung typed
// `Middleware` sits in a layout's lane and on a handler alike. Served by `abide start`, for
// `serve.test.ts`'s reason: happy-dom's preload clobbers `Response`.

import { afterAll, beforeAll, expect, test } from 'bun:test'

import type { AppRung } from '#server/hooks.ts'
import type { Middleware } from '#shared/Middleware.ts'
import type { RpcOptions } from '#shared/rpc.ts'

import { serveApp } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

// ONE RUNG, filed by a layout and listed on a handler: the build typechecks both against `Middleware`.
const SIGNED_IN = `import { type Middleware, refuse } from '@abide/abide'

export const signedIn: Middleware = async (next, { request }) =>
    request.headers.get('x-member') === null ? refuse(401, 'Sign in first.') : next()
`

const ROOT_LAYOUT = `<script server>
import { refuse } from '@abide/abide'
import { middleware } from '@abide/abide/server'

middleware(async (next) => {
    const answer = await next()
    answer.headers.set('x-outer', String(answer.status))
    return answer
})
middleware(async (next, { request }) =>
    new URL(request.url).pathname === '/closed' ? refuse(403, 'Closed.') : next(),
)
</script>

<slot/>
`

const MEMBERS_LAYOUT = `<script server>
import { middleware } from '@abide/abide/server'
import { signedIn } from '#src/lib/signedIn.server.ts'

middleware(signedIn)
</script>

<slot/>
`

const MEMBERS_ERROR = `<script>
import { props, type Failed } from '@abide/abide'

const { failure } = props<{ failure: Failed<string, unknown> }>()
</script>

<h1 id="members">Members only ({failure.status})</h1>`

const ROSTER = `import { GET } from '@abide/abide/server'
import { signedIn } from '#src/lib/signedIn.server.ts'

export default GET(() => ['maya'], { middleware: [signedIn] })
`

let base = ''
let stop = (): void => {}

beforeAll(async () => {
    ;({ base, stop } = await serveApp({
        'layout.abide': ROOT_LAYOUT,
        'index.abide': '<main>home</main>',
        'lib/signedIn.server.ts': SIGNED_IN,
        'members/layout.abide': MEMBERS_LAYOUT,
        'members/index.abide': '<main id="list">the members</main>',
        'members/error.abide': MEMBERS_ERROR,
        'members/roster.handler.ts': ROSTER,
        'open/roster.handler.ts': ROSTER,
    }))
}, 30_000)

afterAll(() => {
    stop()
    removeTemporaryModules()
})

// 37.14 — A PAGE'S LANE PAINTS IT AS ITS ERROR PAGE, at the refusal's status. THE REVERT: in
// `hooks.ts`, push `entry.item` rather than `answering(entry.item, answer)`; the lane is handed a
// `Failed` where it reads a `Response`, and the page answers 500.
test("a refusal a route's rung returns is its error page — 37.14", async () => {
    const refused = await Bun.fetch(`${base}/members/`)
    expect(refused.status).toBe(401)
    expect(await refused.text()).toContain('Members only (401)')
    const admitted = await Bun.fetch(`${base}/members/`, {
        headers: { 'x-member': 'maya' },
    })
    expect(await admitted.text()).toContain('the members')
})

// 37.14 — A HANDLER'S LANE ANSWERS IT AS PROBLEM DETAILS (15.1), the route's rung and the handler's
// own alike. THE REVERT: as above; the route's rung answers 500 while the handler's still refuses.
test('a refusal a rung returns over a handler is Problem Details — 37.14', async () => {
    for (const address of ['/members/roster', '/open/roster']) {
        const refused = await Bun.fetch(`${base}${address}`)
        expect(`${address} ${refused.status}`).toBe(`${address} 401`)
        expect(refused.headers.get('content-type')).toBe(
            'application/problem+json',
        )
        expect(((await refused.json()) as { detail: string }).detail).toBe(
            'Sign in first.',
        )
    }
})

// 37.14 — BEFORE ROUTING THE REQUEST SAYS WHICH LANE (15.22). 37.15 — the rung outside the one that
// refused is handed the answer, so it reads a `Response`. THE REVERT: as above; `/closed` answers 500
// and the outer rung throws reading `headers` off a `Failed`.
test('a root rung refusing is answered in the lane the request asks for, to the rung outside it — 37.14, 37.15', async () => {
    const json = await Bun.fetch(`${base}/closed`, {
        headers: { accept: 'application/json' },
    })
    expect(json.status).toBe(403)
    expect(json.headers.get('content-type')).toBe('application/problem+json')
    expect(json.headers.get('x-outer')).toBe('403')
    const page = await Bun.fetch(`${base}/closed`, {
        headers: { accept: 'text/html' },
    })
    expect(page.status).toBe(403)
    expect(page.headers.get('content-type')).not.toBe(
        'application/problem+json',
    )
    expect(page.headers.get('x-outer')).toBe('403')
})

// ONE `Middleware` FITS EVERY LANE whose context carries what it reads — checked by the typecheck the
// gate runs over this file. THE REVERT: declare `Middleware` with its parameters on the alias again
// (`Middleware<Ctx, Result>`); `handlerLane` stops compiling, since a handler's context is its own.
test('one Middleware fits the app lane and a handler, and a rung reading args only the latter', () => {
    const shared: Middleware = async (next) => next()
    const readsArgs: Middleware<never, { args: () => unknown }> = async (
        next,
        ctx,
    ) => (ctx.args() === undefined ? next() : next())
    const appLane: AppRung = shared
    const handlerLane: NonNullable<
        RpcOptions<{ id: number }>['middleware']
    >[number][] = [shared, readsArgs]
    // @ts-expect-error — the app lane's context has no args to read.
    const misplaced: AppRung = readsArgs
    expect([appLane, misplaced, ...handlerLane].length).toBe(4)
})
