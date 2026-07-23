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
]
