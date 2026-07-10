import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { encodeRefJson } from '../src/lib/shared/encodeRefJson.ts'
import { pendingAsyncCellsSlot } from '../src/lib/shared/pendingAsyncCellsSlot.ts'
import { resolvedCellsSlot } from '../src/lib/shared/resolvedCellsSlot.ts'
import type { PendingAsyncCells } from '../src/lib/shared/types/PendingAsyncCells.ts'
import type { ResolvedCells } from '../src/lib/shared/types/ResolvedCells.ts'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { mount } from '../src/lib/ui/dom/mount.ts'
import { enterScope } from '../src/lib/ui/enterScope.ts'
import { exitScope } from '../src/lib/ui/exitScope.ts'
import { CELL_SEED } from '../src/lib/ui/runtime/CELL_SEED.ts'
import { createAsyncCell } from '../src/lib/ui/runtime/createAsyncCell.ts'
import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'
import { withPath } from '../src/lib/ui/runtime/withPath.ts'
import { installMiniDom } from './support/installMiniDom.ts'
import { settle } from './support/settle.ts'

/*
Stage 2 payoff: an async CELL's resolved value crosses SSR→client keyed by its render-path id, so
the client hydrates the cell WARM — the value shows on the first paint instead of a pending flash +
cold refetch. SSR (`createAsyncCell.settleValue`) records the value into the request-scoped
`resolvedCellsSlot` keyed by `${scope.id}:${index}`; the renderer would stamp it into
`__SSR__.cells` (ref-json); the client seeds `CELL_SEED` and `createAsyncCell` reads it before its
eager run. Here we drive the two halves directly under a shared `withPath` root (the same route
key the SSR `renderChain` and the client router push), which is what makes the keys agree.
*/
beforeAll(() => {
    installMiniDom()
})

/* Give each test its own per-request slots (mirrors ssrAsyncCell.test) so a settling cell records
   into an isolated list and the module-singleton fallback isn't shared across suites. */
let previous: {
    pending: typeof pendingAsyncCellsSlot.resolver
    resolved: typeof resolvedCellsSlot.resolver
}
beforeEach(() => {
    previous = { pending: pendingAsyncCellsSlot.resolver, resolved: resolvedCellsSlot.resolver }
    const pending: PendingAsyncCells = { promises: [] }
    const resolved: ResolvedCells = { entries: [] }
    pendingAsyncCellsSlot.resolver = () => pending
    resolvedCellsSlot.resolver = () => resolved
})
afterEach(() => {
    pendingAsyncCellsSlot.resolver = previous.pending
    resolvedCellsSlot.resolver = previous.resolved
    for (const key of Object.keys(CELL_SEED)) {
        delete CELL_SEED[key]
    }
})

const ROUTE = '/products/[id]'
/* A page-level async cell: `await` marks it async, so it's a blocking cell that the SSR barrier
   settles; the template renders its resolved value. */
const SOURCE =
    `<script>import { state } from '@abide/abide/ui/state'\n` +
    `const profile = state.computed(await load())</script>\n` +
    `<p>{profile}</p>`

describe('async cell warm-seed crosses SSR→client by render-path id', () => {
    test('SSR records the resolved value keyed by the render-path scope id', async () => {
        const ssrBody = compileSSR(SOURCE)
        const load = () => Promise.resolve('ADA')
        /* Root the render at the route key, exactly as `renderChain` does — so the cell's scope id
           is the render-path, not the run-unique counter. */
        const render = await withPath(ROUTE, () =>
            new Function('$props', '$ctx', 'load', ssrBody)(undefined, undefined, load),
        )
        expect((render as SsrRender).html).toBe('<p>ADA</p>') // baked into the HTML by the barrier

        const entries = resolvedCellsSlot.get()?.entries ?? []
        expect(entries.length).toBe(1)
        // key = `${scope.id}:${index}`; scope.id is the escaped route, index 0 (the first cell)
        expect(entries[0]?.key).toBe('~1products~1[id]:0')
        expect(entries[0]?.value).toBe('ADA')
    })

    test('the client hydrates the cell WARM from the seed — value on first paint, no pending flash', async () => {
        // Seed as the renderer would: ref-json-encode the SSR value under its render-path key.
        CELL_SEED['~1products~1[id]:0'] = encodeRefJson('ADA')

        const clientBody = compileComponent(SOURCE)
        const build = (host: Element, _props: unknown) =>
            new Function('host', 'load', clientBody)(host, load)
        const host = document.createElement('div')
        /* The client seed never resolves within the test tick, so ANY value on first paint can only
           have come from the warm seed (a cold cell would peek `undefined` → empty). */
        const load = () => new Promise<string>(() => {})
        /* Mount under the route root, exactly as the client router does — `mount`'s `withScope`
           creates the component scope with id = the render-path, matching the SSR key. */
        withPath(ROUTE, () => mount(host, build))

        // WARM: the SSR value is present synchronously, before any settle — no pending flash.
        expect(host.textContent).toBe('ADA')
        await settle()
        expect(host.textContent).toBe('ADA') // stays (the never-resolving revalidation can't clear it)
    })

    /* Regression (streaming/blocking divergence): a STREAMING cell (ADR-0032 no-`await`) ships
       PENDING in the SSR shell — it is off the Tier-2 barrier, and its promise never settles during
       the synchronous render, so the HTML holds the pending state. If it settles server-side before
       flush (a fast read the render didn't wait for) it must STILL NOT warm-seed: seeding the
       resolved value while the shell shows pending diverges on hydrate (a claimed text node reads
       the seed, the SSR DOM has the pending markup → `assertClaimedText` desync). Only BLOCKING
       cells — whose value the barrier baked into the HTML — warm-seed. */
    test('a streaming cell that settles server-side does NOT warm-seed; a blocking sibling does', async () => {
        const previous = await withPath(ROUTE, async () => {
            const saved = enterScope()
            /* Two cells under one scope: index 0 blocking, index 1 streaming. Both settle a tick
               later, exercising the "settled before flush, after render" window the bug lived in. */
            createAsyncCell(() => Promise.resolve('BLOCK'), { writable: false, streaming: false })
            createAsyncCell(() => Promise.resolve('STREAM'), { writable: false, streaming: true })
            await settle()
            return saved
        })
        exitScope(previous)

        const entries = resolvedCellsSlot.get()?.entries ?? []
        /* Only the blocking cell (index 0) recorded; the streaming cell (index 1) is absent. */
        expect(entries.map((entry) => entry.value)).toEqual(['BLOCK'])
        expect(entries[0]?.key).toBe('~1products~1[id]:0')
        expect(entries.some((entry) => entry.value === 'STREAM')).toBe(false)
    })

    test('a MISSING seed (key mismatch) falls back to a cold pending read — safe, no crash', async () => {
        // No CELL_SEED entry, or a different route → the client cell finds nothing and runs cold.
        const clientBody = compileComponent(SOURCE)
        const load = () => new Promise<string>(() => {})
        const build = (host: Element, _props: unknown) =>
            new Function('host', 'load', clientBody)(host, load)
        const host = document.createElement('div')
        withPath('/other/route', () => mount(host, build))
        // Cold: pending → the bare read peeks undefined → empty, no crash.
        expect(host.textContent).toBe('')
    })
})
