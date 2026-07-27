// THE STANDARD FRONTEND BENCH CORPUS — the single source of truth for both the CLI runner (`run.ts`,
// which drives render/mount/update through happy-dom) and the docs-app live render bench
// (`packages/docs/src/server/rpc/benchFrontend.ts`, which streams the SSR `render` numbers to
// `/platform/bench`). Kept in one place so the two never drift.
//
// A fixed, representative set of `.abide` workloads exercising the three hot paths every frontend build
// shares: `render` (SSR string), `mount` (client DOM construction), and `update` (a reactive state
// change + microtask-flushed DOM patch). Deliberately INLINE and STABLE so bench numbers stay comparable
// release-over-release — changing a scenario's `src`/`scope` breaks historical comparability; add a new
// scenario instead.
//
// A `<script>`'s imports are resolved by the page builder into `$scope`, not by the emitted module, so
// scenarios that use `state`/`watch` must inject them (mirrors the page-scope the oracle builds).

import { state } from 'abide/shared/state'
import { watch } from 'abide/shared/watch'

export interface Scenario {
    name: string
    src: string
    // Fresh render/mount scope per invocation (promises, arrays, etc. must not be shared across ops).
    scope: () => Record<string, unknown>
    // Skip the SSR `render` pass (interaction-only / script-bearing workloads). The docs render bench
    // also uses this to filter to server-renderable scenarios.
    server?: boolean
    // Element count for list scenarios — lets a render bench report ns/row and demonstrate O(n) scaling.
    rows?: number
    // One reactive-update unit of work over a mounted host: mutate, then await the DOM patch. Present
    // only on scenarios that own reactive state; drives the CLI runner's `update` metric.
    update?: (host: HTMLElement) => Promise<void>
}

// Flush the reactive scheduler's queued microtask so DOM patches land before the next timed op.
async function flush(): Promise<void> {
    await Promise.resolve()
    await Promise.resolve()
}

function range(n: number): number[] {
    const out: number[] = []
    for (let i = 0; i < n; i++) out.push(i)
    return out
}

export const SCENARIOS: Scenario[] = [
    {
        name: 'static-text',
        src: '<p>hello world</p>',
        scope: () => ({}),
    },
    {
        name: 'interpolation',
        src: '<p>Hi {name}, you have {count} messages</p>',
        scope: () => ({ name: 'Bob', count: 7 }),
    },
    {
        name: 'attributes',
        src: '<a id={id} href={href} title={title} class={cls}>link</a>',
        scope: () => ({ id: 'n1', href: '/x', title: 'go', cls: 'btn primary' }),
    },
    {
        name: 'if-else',
        src: '{#if show}<p>{msg}</p>{:else}<p>hidden</p>{/if}',
        scope: () => ({ show: true, msg: 'visible' }),
    },
    {
        name: 'for-list-100',
        src: '<ul>{#for n of items by n}<li>row {n}</li>{/for}</ul>',
        scope: () => ({ items: range(100) }),
        rows: 100,
    },
    {
        name: 'for-list-1000',
        src: '<ul>{#for n of items by n}<li>row {n}</li>{/for}</ul>',
        scope: () => ({ items: range(1000) }),
        rows: 1000,
    },
    {
        name: 'for-list-10000',
        src: '<ul>{#for n of items by n}<li>row {n}</li>{/for}</ul>',
        scope: () => ({ items: range(10000) }),
        rows: 10000,
    },
    {
        name: 'nested-for-if-50',
        src: '{#for row of rows by row.id}<section>{#if row.on}<b>{row.id}</b>{:else}<i>{row.id}</i>{/if}</section>{/for}',
        scope: () => ({ rows: range(50).map((i) => ({ id: i, on: i % 2 === 0 })) }),
        rows: 50,
    },
    {
        name: 'switch',
        src: '{#switch color}{:case "red"}<p>red</p>{:case "blue"}<p>blue</p>{:default}<p>other</p>{/switch}',
        scope: () => ({ color: 'blue' }),
    },
    {
        name: 'class-style-directives',
        src: '<div class:active={active} class:big={big} style:color={hue} style:width={width}>box</div>',
        scope: () => ({ active: true, big: false, hue: 'red', width: '40px' }),
    },
    {
        name: 'await-block',
        src: '{#await p}<em>loading</em>{:then v}<p>{v}</p>{:catch e}<span>{e}</span>{/await}',
        scope: () => ({ p: Promise.resolve('ready') }),
    },
    {
        name: 'state-update',
        src: "<script>import { state } from 'abide/shared/state'; let count = state(0)</script><button onclick={() => count++}>+</button><span>{count}</span>",
        scope: () => ({ state, watch }),
        server: false,
        update: async (host) => {
            const button = host.querySelector('button')
            if (!button) throw new Error('state-update scenario is missing its button')
            button.click()
            await flush()
        },
    },
    {
        name: 'list-append-update',
        src: "<script>import { state } from 'abide/shared/state'; let items = state([0])</script><button onclick={() => (items = [...items, items.length])}>add</button><ul>{#for n of items by n}<li>{n}</li>{/for}</ul>",
        scope: () => ({ state, watch }),
        server: false,
        update: async (host) => {
            const button = host.querySelector('button')
            if (!button) throw new Error('list-append-update scenario is missing its button')
            button.click()
            await flush()
        },
    },
    {
        name: 'list-reverse-1000',
        src: "<script>import { state } from 'abide/shared/state'; let items = state(Array.from({ length: 1000 }, (_, i) => i))</script><button onclick={() => (items = [...items].reverse())}>rev</button><ul>{#for n of items by n}<li>{n}</li>{/for}</ul>",
        scope: () => ({ state, watch }),
        server: false,
        rows: 1000,
        update: async (host) => {
            const button = host.querySelector('button')
            if (!button) throw new Error('list-reverse-1000 scenario is missing its button')
            button.click()
            await flush()
        },
    },
    {
        name: 'if-toggle',
        src: "<script>import { state } from 'abide/shared/state'; let on = state(true)</script><button onclick={() => (on = !on)}>t</button>{#if on}<p>A</p>{:else}<p>B</p>{/if}",
        scope: () => ({ state, watch }),
        server: false,
        update: async (host) => {
            const button = host.querySelector('button')
            if (!button) throw new Error('if-toggle scenario is missing its button')
            button.click()
            await flush()
        },
    },

    // ---------------------------------------------------------------------------
    // SHAPE coverage. Everything above is WIDE and SHALLOW (one or two nesting levels), so per-LEVEL
    // and per-BOUNDARY cost is invisible to it — exactly the class of overhead that hides in an
    // emitter. These three vary the shape instead of the size.
    // ---------------------------------------------------------------------------

    {
        // Real templates interleave static text with several values in ONE element. Each value is its
        // own reactive leaf (a text node plus an anchor), so this measures per-LEAF cost at a density
        // the single-value `interpolation` scenario never reaches.
        name: 'many-interpolations',
        src: '<p>{a} {b} {c} {d} {e} {f} {g} {h}</p>',
        scope: () => ({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 }),
    },
    {
        // Ten nesting levels over ONE leaf value: the cost here is almost entirely per-level frame
        // overhead, not content. A change to how the emitter brackets a level shows up here and
        // essentially nowhere else in the corpus.
        name: 'deep-tree-10',
        src: '<div><div><div><div><div><div><div><div><div><span>{v}</span></div></div></div></div></div></div></div></div></div>',
        scope: () => ({ v: 'leaf' }),
    },
    {
        // A component boundary per row. `for-list-100` renders the same 100 `<li>`s with the body
        // inline, so the DIFFERENCE between the two is the price of the boundary itself — the props
        // object, the child scope, the children factory, and the extra anchors a component slot carries.
        name: 'component-list-100',
        src: '{#component Row({ item })}<li>row {item}</li>{/component}<ul>{#for n of items by n}<Row item={n}/>{/for}</ul>',
        scope: () => ({ items: range(100) }),
        rows: 100,
    },

    // ---------------------------------------------------------------------------
    // KEYED-LIST MUTATIONS. `list-append-update` and `list-reverse-1000` cover the two extremes (one
    // appended row; every row moved). These are the mutations in between — the ones that separate a
    // keyed reconcile that does O(1) DOM work from one that rebuilds. A full reverse cannot make that
    // distinction, because it is O(n) moves under any algorithm.
    // ---------------------------------------------------------------------------

    {
        // Two rows exchange places. A correct keyed reconcile moves TWO ranges; a positional one
        // rewrites every row between them.
        name: 'list-swap-1000',
        src: "<script>import { state } from 'abide/shared/state'; let items = state(Array.from({ length: 1000 }, (_, i) => i))</script><button onclick={() => { const next = [...items]; const held = next[1]; next[1] = next[998]; next[998] = held; items = next }}>swap</button><ul>{#for n of items by n}<li>{n}</li>{/for}</ul>",
        scope: () => ({ state, watch }),
        server: false,
        rows: 1000,
        update: async (host) => {
            const button = host.querySelector('button')
            if (!button) throw new Error('list-swap-1000 scenario is missing its button')
            button.click()
            await flush()
        },
    },
    {
        // One row leaves from the middle. Should be a single item disposal plus a single range removal,
        // with every surviving row's DOM untouched.
        name: 'list-remove-1000',
        src: "<script>import { state } from 'abide/shared/state'; let items = state(Array.from({ length: 1000 }, (_, i) => i))</script><button onclick={() => { const next = [...items]; next.splice(500, 1); items = next }}>rm</button><ul>{#for n of items by n}<li>{n}</li>{/for}</ul>",
        scope: () => ({ state, watch }),
        server: false,
        rows: 1000,
        update: async (host) => {
            const button = host.querySelector('button')
            if (!button) throw new Error('list-remove-1000 scenario is missing its button')
            button.click()
            await flush()
        },
    },
    {
        // Every tenth row's TEXT changes and the keys all stay put — so there is no structural work at
        // all, only 100 leaf writes. This is the scenario that catches a reconcile doing DOM moves it
        // did not need to do.
        name: 'list-partial-update-1000',
        src: "<script>import { state } from 'abide/shared/state'; let rows = state(Array.from({ length: 1000 }, (_, i) => ({ id: i, text: 'row ' + i })))</script><button onclick={() => (rows = rows.map((row, i) => (i % 10 === 0 ? { id: row.id, text: row.text + 'x' } : row)))}>bump</button><ul>{#for row of rows by row.id}<li>{row.text}</li>{/for}</ul>",
        scope: () => ({ state, watch }),
        server: false,
        rows: 1000,
        update: async (host) => {
            const button = host.querySelector('button')
            if (!button) throw new Error('list-partial-update-1000 scenario is missing its button')
            button.click()
            await flush()
        },
    },
    {
        // ONE row's class toggles, but every row's `class:` binding reads the same `selected` cell — so
        // this is the corpus's fine-grainedness probe. Hand-written, it is two `classList` calls; the
        // ratio says how much of the list the framework re-visits to achieve the same two changes.
        name: 'list-select-1000',
        src: "<script>import { state } from 'abide/shared/state'; let items = state(Array.from({ length: 1000 }, (_, i) => i)); let selected = state(-1)</script><button onclick={() => (selected = selected === 500 ? -1 : 500)}>sel</button><ul>{#for n of items by n}<li class:sel={n === selected}>{n}</li>{/for}</ul>",
        scope: () => ({ state, watch }),
        server: false,
        rows: 1000,
        update: async (host) => {
            const button = host.querySelector('button')
            if (!button) throw new Error('list-select-1000 scenario is missing its button')
            button.click()
            await flush()
        },
    },
    {
        // Every key changes, so nothing can be reused: 1000 disposals plus 1000 fresh items. The
        // worst-case reconcile, and the upper bound the other mutations should sit far below.
        name: 'list-replace-1000',
        src: "<script>import { state } from 'abide/shared/state'; let items = state(Array.from({ length: 1000 }, (_, i) => i))</script><button onclick={() => (items = items.map((n) => n + 1000))}>rep</button><ul>{#for n of items by n}<li>{n}</li>{/for}</ul>",
        scope: () => ({ state, watch }),
        server: false,
        rows: 1000,
        update: async (host) => {
            const button = host.querySelector('button')
            if (!button) throw new Error('list-replace-1000 scenario is missing its button')
            button.click()
            await flush()
        },
    },
    {
        // Clear-by-RECONCILE (the list becomes empty), which is a different path from clear-by-DISPOSE
        // — the latter is what the `unmount` metric measures on `for-list-1000`.
        //
        // READ THIS ONE CAREFULLY: an emptied list cannot be emptied again, so the button ALTERNATES
        // clear and rebuild. Each timed op is therefore one or the other, and the reported mean is the
        // average of a full clear and a full rebuild — NOT the cost of a clear. It is still a sound
        // regression guard (either half getting slower moves the number); it is not a figure to quote.
        name: 'list-clear-1000',
        src: "<script>import { state } from 'abide/shared/state'; const all = Array.from({ length: 1000 }, (_, i) => i); let items = state(all)</script><button onclick={() => (items = items.length > 0 ? [] : all)}>clr</button><ul>{#for n of items by n}<li>{n}</li>{/for}</ul>",
        scope: () => ({ state, watch }),
        server: false,
        rows: 1000,
        update: async (host) => {
            const button = host.querySelector('button')
            if (!button) throw new Error('list-clear-1000 scenario is missing its button')
            button.click()
            await flush()
        },
    },
]
