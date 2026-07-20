// The standard frontend bench corpus.
//
// A fixed, representative set of `.abide` frontend workloads exercised by `bench/run.ts`. Each entry
// is compiled once (via `loadEmitted`) and then driven repeatedly across the three hot paths every
// frontend build shares: `render` (SSR string), `mount` (client DOM construction), and `update` (a
// reactive state change + microtask-flushed DOM patch).
//
// This corpus is deliberately INLINE and STABLE — kept separate from the test fixture corpus so bench
// numbers stay comparable release-over-release even as tests churn. Changing a scenario's `src` or
// `scope` breaks historical comparability; add a new scenario instead.
//
// A `<script>`'s imports are resolved by the page builder into `$scope`, not by the emitted module, so
// scenarios that use `state`/`watch` must inject them (mirrors the oracle's `scriptScope`).

import { state } from '../src/lib/ui/state.ts'
import { watch } from '../src/lib/ui/watch.ts'

export interface Scenario {
    name: string
    src: string
    // Fresh render/mount scope per invocation (promises, arrays, etc. must not be shared across ops).
    scope: () => Record<string, unknown>
    // Skip the SSR `render` pass (e.g. interaction-only workloads where server HTML is uninteresting).
    server?: boolean
    // One reactive-update unit of work over a mounted host: mutate, then await the DOM patch. Present
    // only on scenarios that own reactive state; drives the `update` metric.
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
    },
    {
        name: 'for-list-1000',
        src: '<ul>{#for n of items by n}<li>row {n}</li>{/for}</ul>',
        scope: () => ({ items: range(1000) }),
    },
    {
        name: 'for-list-10000',
        src: '<ul>{#for n of items by n}<li>row {n}</li>{/for}</ul>',
        scope: () => ({ items: range(10000) }),
    },
    {
        name: 'nested-for-if-50',
        src: '{#for row of rows by row.id}<section>{#if row.on}<b>{row.id}</b>{:else}<i>{row.id}</i>{/if}</section>{/for}',
        scope: () => ({ rows: range(50).map((i) => ({ id: i, on: i % 2 === 0 })) }),
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
        src: "<script>import { state } from 'abide/ui/state'; let count = state(0)</script><button onclick={() => count++}>+</button><span>{count}</span>",
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
        src: "<script>import { state } from 'abide/ui/state'; let items = state([0])</script><button onclick={() => (items = [...items, items.length])}>add</button><ul>{#for n of items by n}<li>{n}</li>{/for}</ul>",
        scope: () => ({ state, watch }),
        server: false,
        update: async (host) => {
            const button = host.querySelector('button')
            if (!button) throw new Error('list-append-update scenario is missing its button')
            button.click()
            await flush()
        },
    },
]
