import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { pendingAsyncCellsSlot } from '../src/lib/shared/pendingAsyncCellsSlot.ts'
import type { PendingAsyncCells } from '../src/lib/shared/types/PendingAsyncCells.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'
import { installMiniDom } from './support/installMiniDom.ts'

/*
The SSR Tier-2 await-barrier (ADR-0019): an async cell (`state.computed(await …)`)
runs its seed eagerly during the SSR pass, registering its in-flight promise on the
request-scoped pending list. The compiler emits `await $$settleAsyncCells()` between
the cell declarations and the template, so the barrier drains + awaits every registered
promise BEFORE the template's `$$readCell(cell)` peeks it — baking the resolved value
into the first-pass HTML instead of Tier-1 blank markup the client refetches.

These drive the compiled render body directly (no request scope), so `pendingAsyncCellsSlot`
falls back to its module-singleton list; the drain keeps it isolated across barriers. The
server-side registration guard (`typeof window === 'undefined'`) fires here because the SSR
harness installs no `window`.
*/

beforeAll(() => {
    installMiniDom()
})

/* Give each render its OWN pending list — as a real request scope does (runWithRequestScope
   seeds `store.pendingAsyncCells`). Without this the module-singleton fallback is shared with
   every other suite in the process: the client-mount cell tests (`reactiveTry`, `readCellThrow`)
   run with `window` undefined too, so they register into the same fallback and leave never-
   settling deferreds behind, which would hang this barrier's drain. */
let previousResolver: (() => PendingAsyncCells | undefined) | undefined
beforeEach(() => {
    previousResolver = pendingAsyncCellsSlot.resolver
    const list: PendingAsyncCells = { promises: [] }
    pendingAsyncCellsSlot.resolver = () => list
})
afterEach(() => {
    pendingAsyncCellsSlot.resolver = previousResolver
})

/* Compile a component's SSR body and run it as the render function, injecting the author-script
   helpers it references by bare name; the `$$`-prefixed runtime (`$$settleAsyncCells`,
   `$$readCell`, `$$enterScope`, …) resolves through the uiPreload globals. */
function render(
    source: string,
    helpers: Record<string, unknown> = {},
): Promise<SsrRender> | SsrRender {
    const ssrBody = compileSSR(source)
    const names = Object.keys(helpers)
    const values = names.map((name) => helpers[name])
    return new Function('$props', '$ctx', ...names, ssrBody)(undefined, undefined, ...values) as
        | Promise<SsrRender>
        | SsrRender
}

describe('SSR Tier-2 barrier bakes resolved async-cell values into the HTML', () => {
    /* Goal 1: the cell's promise settles AFTER a tick, yet the barrier awaits it before the
       template peeks — so the resolved value is in the first-pass HTML, not `undefined`. */
    test('a deferred async computed resolves into the markup (not blank)', async () => {
        const gate = () => new Promise((resolve) => setTimeout(() => resolve('BAKED'), 0))
        const { html } = await render(
            `
            <script>import { state } from '@abide/abide/ui/state'
            const u = state.computed(await gate())</script>
            <div>{u}</div>
        `,
            { gate },
        )
        expect(html).toContain('BAKED')
        expect(html).toBe('<div>BAKED</div>')
    })

    /* The barrier is what makes it Tier-2: the emitted body carries the await-barrier before
       the template push, so a peek can never precede the settle. */
    test('the compiled body emits the barrier before the template', () => {
        const body = compileSSR(`
            <script>import { state } from '@abide/abide/ui/state'
            const u = state.computed(await gate())</script>
            <div>{u}</div>
        `)
        const barrierAt = body.indexOf('await $$settleAsyncCells();')
        const templateAt = body.indexOf('$out.push($text($$readCell(u)))')
        expect(barrierAt).toBeGreaterThan(-1)
        expect(templateAt).toBeGreaterThan(barrierAt)
    })

    /* Chained blocking cells: cell `b`'s `await` seed reads cell `a`. On SSR, `b`'s seed reads a
       still-pending `a` in its synchronous prefix and PAUSES (the read throws, propagating pending
       down the edge), so `b` registers no real promise on the first pass. When `a` settles inside
       the barrier, the synchronous reactive flush re-runs `b`'s seed with `a` RESOLVED, which
       registers `b`'s promise — and the barrier's fixpoint drain awaits that too, resolving the
       whole chain in order. Before pending propagated, `b` read `a` as `undefined` and baked the
       wrong value; here it bakes `A->B`. */
    test('a chain of blocking cells resolves in order (barrier drains to a fixpoint)', async () => {
        const first = () => new Promise((resolve) => setTimeout(() => resolve('A'), 0))
        const second = (upstream: string) =>
            new Promise((resolve) => setTimeout(() => resolve(`${upstream}_then_B`), 0))
        const { html } = await render(
            `
            <script>import { state } from '@abide/abide/ui/state'
            const a = state.computed(await first())
            const b = state.computed(await second(a))</script>
            <div>{b}</div>
        `,
            { first, second },
        )
        expect(html).toBe('<div>A_then_B</div>')
    })

    /* Goal 2 companion: a rejected cell settles into `error()` (allSettled never rejects the
       render), and the read-site surfaces it through the nearest `{#try}` catch rather than
       crashing the whole render. */
    test('a rejected async cell renders its catch branch, not a render crash', async () => {
        const boom = () => Promise.reject(new Error('nope'))
        const result = await render(
            `
            <script>import { state } from '@abide/abide/ui/state'
            const u = state.computed(await boom())</script>
            {#try}<span>{u}</span>{:catch e}<b>failed</b>{/try}
        `,
            { boom },
        )
        expect(result.html).toContain('failed')
        expect(result.html).not.toContain('<span>')
    })
})

/* ADR-0047: `{#await <asyncCell>}` awaits the cell's RESOLUTION instead of peeking its
   `undefined`-while-pending value. The subject is passed raw and normalised by `$$awaitSubject`,
   so a streaming `computed(getFoo())` cell shows its pending branch on SSR and its `{:then}` value
   is baked into the stream — not `then(undefined)` (the probes `{#await rates}` crash). */
describe('{#await <cell>} awaits the cell, not its peek (ADR-0047)', () => {
    test('a streaming computed cell resolves into the {:then} branch on SSR', async () => {
        const getFoo = () => new Promise((resolve) => setTimeout(() => resolve({ base: 'USD' }), 0))
        const result = (await render(
            `
            <script>import { state } from '@abide/abide/ui/state'
            const rates = state.computed(getFoo({ base: 'USD' }))</script>
            {#await rates}<p>loading…</p>{:then data}<p>base {data.base}</p>{:catch e}<p>err</p>{/await}
        `,
            { getFoo },
        )) as SsrRender
        /* The shell ships the pending branch; the resolved value streams via the await entry. */
        expect(result.html).toContain('loading…')
        expect(result.awaits.length).toBe(1)
        const entry = result.awaits[0] as NonNullable<(typeof result.awaits)[number]>
        const value = await Promise.resolve(entry.promise())
        const thenHtml = await entry.then(value)
        expect(thenHtml).toContain('base USD') // NOT `base ` with undefined
    })

    test('an errored cell subject routes to the {:catch} branch, not a crash', async () => {
        /* An `await` async cell (no trackedComputed promise-probe) so the rejection lands cleanly
           in the cell's `error()` — the barrier settles it, then the await subject rejects. */
        const boom = () => Promise.reject(new Error('down'))
        const result = (await render(
            `
            <script>import { state } from '@abide/abide/ui/state'
            const rates = state.computed(await boom())</script>
            {#await rates}<p>loading…</p>{:then data}<p>{data.base}</p>{:catch e}<p>err {e.message}</p>{/await}
        `,
            { boom },
        )) as SsrRender
        const entry = result.awaits[0] as NonNullable<(typeof result.awaits)[number]>
        let caught: unknown
        try {
            await Promise.resolve(entry.promise())
        } catch (error) {
            caught = error
        }
        const catchHtml = await entry.catch?.(caught)
        expect(catchHtml).toContain('err down')
    })
})

describe('SSR barrier is inert for components with no async cells', () => {
    /* Goal 3 regression: a component that declares no cell emits no barrier and stays a plain
       synchronous render (no spurious `await`, no async wrapper). */
    test('a plain-state component emits no barrier and renders unchanged', () => {
        const source = `
            <script>import { state } from '@abide/abide/ui/state'
            const n = state(41)</script>
            <p>{n}</p>
        `
        const body = compileSSR(source)
        expect(body).not.toContain('$$settleAsyncCells')
        /* No inline await anywhere → the body is NOT wrapped in the async IIFE. */
        expect(body).not.toContain('return (async () =>')
        const result = render(source) as SsrRender
        expect(result.html).toBe('<p>41</p>')
    })
})
