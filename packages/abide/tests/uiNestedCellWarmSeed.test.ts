import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { encodeRefJson } from '../src/lib/shared/encodeRefJson.ts'
import { pendingAsyncCellsSlot } from '../src/lib/shared/pendingAsyncCellsSlot.ts'
import { resolvedCellsSlot } from '../src/lib/shared/resolvedCellsSlot.ts'
import type { PendingAsyncCells } from '../src/lib/shared/types/PendingAsyncCells.ts'
import type { ResolvedCells } from '../src/lib/shared/types/ResolvedCells.ts'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { mount } from '../src/lib/ui/dom/mount.ts'
import { CELL_SEED } from '../src/lib/ui/runtime/CELL_SEED.ts'
import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'
import { withPath } from '../src/lib/ui/runtime/withPath.ts'
import { installMiniDom } from './support/installMiniDom.ts'
import { settle } from './support/settle.ts'

/*
Regression for the SSR nested render-path gap: an async CELL inside a `<Child/>` nested in a
control-flow block (`{#for}` row, `{#if}` branch) must warm-seed across SSR→client. That only
works if the child's scope id is BYTE-IDENTICAL on both sides, and the id is the ambient
render-path composed top-down. The CLIENT pushes a segment per each-row (`each` → the row
key/position) and per if/switch branch (`when`/`switchBlock` → the branch key); SSR previously
pushed NONE inside those blocks, so a nested child's id diverged (`route/childOrdinal` server vs
`route/rowSegment/childOrdinal` client) and the warm-seed missed → the cell refetched and flashed.

`generateSSR` now wraps a scope-creating branch/row body in `$$withPath(<same segment>)`. These
tests prove the halves compose the SAME key: SSR records the resolved value keyed by the child's
render-path id; seeding `CELL_SEED` under that exact key and mounting the client hydrates the cell
WARM — and the client CONSUMES (deletes) that seed, which can only happen if it looked up the
identical key. Driven directly under a shared `withPath` root (the route key the SSR `renderChain`
and the client router both push), mirroring the flat-case `uiCellWarmSeed` test.
*/
beforeAll(() => {
    installMiniDom()
})

/* Per-test request slots (mirrors uiCellWarmSeed / ssrAsyncCell): a settling child cell records
   into an isolated list rather than the shared module-singleton fallback. */
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
/* The escaped route (createScope's id for a scope built under `withPath(ROUTE)`); the `/`s become
   `~1` JSON-Pointer tokens so a slash-bearing segment stays one path element. */
const ROUTE_ID = '~1products~1[id]'

/* A child component holding ONE blocking async cell — the SSR barrier settles it, the client warm-
   seeds it. Its resolved value shows at `<b>`. `load` is a closure the caller swaps between the two
   halves (resolve server-side, never-resolve client-side, so any client value is proof of the warm
   seed). */
const CHILD_SOURCE =
    `<script>import { state } from '@abide/abide/ui/state'\n` +
    `const v = state.computed(await load())</script>\n` +
    `<b>{v}</b>`

/* A compiled child as a `UiComponent`-shaped object (`build` for the client mount via
   `mountChild`, `render` for SSR), both closing over a swappable `load`. */
type ChildComponent = {
    build: (host: Element, props?: unknown) => unknown
    render: (props?: unknown, ctx?: unknown) => SsrRender | Promise<SsrRender>
}
function makeChild(): { Child: ChildComponent; setLoad: (fn: () => Promise<string>) => void } {
    let load: () => Promise<string> = () => Promise.resolve('SEED')
    const clientBody = compileComponent(CHILD_SOURCE)
    const ssrBody = compileSSR(CHILD_SOURCE)
    const Child: ChildComponent = {
        build: (host: Element, props?: unknown) =>
            new Function('host', '$props', 'load', clientBody)(host, props, () => load()),
        render: (props?: unknown, ctx?: unknown) =>
            new Function('$props', '$ctx', 'load', ssrBody)(props, ctx, () => load()) as
                | SsrRender
                | Promise<SsrRender>,
    }
    return { Child, setLoad: (fn) => (load = fn) }
}

/* Compile a parent template (referencing `Child` and `items` by bare name) into both a client
   build fn and an SSR render fn, injecting the child + data. */
function makeParent(
    source: string,
    Child: unknown,
    items: unknown,
): {
    build: (host: Element) => void
    render: (ctx?: unknown) => SsrRender | Promise<SsrRender>
} {
    const clientBody = compileComponent(source)
    const ssrBody = compileSSR(source)
    return {
        build: (host: Element) =>
            new Function('host', '$props', 'Child', 'items', clientBody)(
                host,
                undefined,
                Child,
                items,
            ),
        render: (ctx?: unknown) =>
            new Function('$props', '$ctx', 'Child', 'items', ssrBody)(
                undefined,
                ctx,
                Child,
                items,
            ) as SsrRender | Promise<SsrRender>,
    }
}

describe('nested async cell warm-seed — the SSR row/branch render-path segment matches the client', () => {
    /* A cell in a <Child/> nested in a {#for} row: key = route / row-position / child-ordinal / cell. */
    test('{#for} row: SSR records the child cell under route/rowSegment/childOrdinal, client warm-adopts it', async () => {
        const { Child, setLoad } = makeChild()
        const parent = makeParent(`{#for x of items}<Child/>{/for}`, Child, [{}])

        // --- SSR half: the child's barrier bakes the value and records it by render-path id.
        setLoad(() => Promise.resolve('ADA'))
        const ssr = (await withPath(ROUTE, () => parent.render())) as SsrRender
        expect(ssr.html).toContain('ADA') // baked into the first-pass HTML

        const entries = resolvedCellsSlot.get()?.entries ?? []
        expect(entries.length).toBe(1)
        // The `/0/` segment is the ROW position the client `each` also pushes — its presence is the fix.
        const key = entries[0]?.key
        expect(key).toBe(`${ROUTE_ID}/0/0:0`)
        expect(entries[0]?.value).toBe('ADA')

        // --- Client half: seed under the SSR key, mount with a never-resolving load.
        CELL_SEED[key as string] = encodeRefJson('ADA')
        setLoad(() => new Promise<string>(() => {}))
        const host = document.createElement('div')
        withPath(ROUTE, () => mount(host, (h: Element) => parent.build(h)))

        // WARM: value on first paint (a cold cell would peek undefined → empty), no refetch flash.
        expect(host.textContent).toContain('ADA')
        // The seed was CONSUMED — the client cell looked up the byte-identical key (direct id-equality proof).
        expect(CELL_SEED[key as string]).toBeUndefined()
        await settle()
        expect(host.textContent).toContain('ADA') // stays (the never-resolving revalidation can't clear it)
    })

    /* A cell in a <Child/> nested in an {#if} then-branch: key = route / 'then' / child-ordinal / cell. */
    test('{#if} branch: SSR records the child cell under route/then/childOrdinal, client warm-adopts it', async () => {
        const { Child, setLoad } = makeChild()
        const parent = makeParent(`{#if items.length}<Child/>{/if}`, Child, [{}])

        setLoad(() => Promise.resolve('GRACE'))
        const ssr = (await withPath(ROUTE, () => parent.render())) as SsrRender
        expect(ssr.html).toContain('GRACE')

        const entries = resolvedCellsSlot.get()?.entries ?? []
        expect(entries.length).toBe(1)
        // The `/then/` segment is the `when` branch key the client pushes.
        const key = entries[0]?.key
        expect(key).toBe(`${ROUTE_ID}/then/0:0`)

        CELL_SEED[key as string] = encodeRefJson('GRACE')
        setLoad(() => new Promise<string>(() => {}))
        const host = document.createElement('div')
        withPath(ROUTE, () => mount(host, (h: Element) => parent.build(h)))

        expect(host.textContent).toContain('GRACE')
        expect(CELL_SEED[key as string]).toBeUndefined() // consumed → identical key both sides
    })
})
