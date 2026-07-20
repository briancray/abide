import { GET } from 'abide/server/GET'
import { jsonl } from 'abide/server/jsonl'
import { loadEmittedServer } from 'abide/ui/internal/emit'

// LIVE FRONTEND RENDER BENCH (server side).
//
// Compiles a fixed corpus of `.abide` templates and times the SSR `render` path for each — the pure
// string-build hot path, which needs no DOM and is genuinely abide-bound (unlike client `mount`, whose
// large-list cost in a JS-DOM is dominated by the DOM backend's O(n) insertBefore). Results stream one
// scenario at a time via `jsonl`, so the page fills its table live with `{#for await}`. A short sleep
// between scenarios keeps the streaming visible; refresh re-runs the whole corpus.

interface Scenario {
    name: string
    src: string
    scope: () => Record<string, unknown>
    // Element count for list scenarios — lets the page show ns/row and demonstrate linear scaling.
    rows?: number
}

function range(n: number): number[] {
    const out: number[] = []
    for (let i = 0; i < n; i++) out.push(i)
    return out
}

// Template-only (no `<script>`) so each renders with just its scope — no runtime injection needed.
const SCENARIOS: Scenario[] = [
    { name: 'static-text', src: '<p>hello world</p>', scope: () => ({}) },
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
        name: 'switch',
        src: '{#switch color}{:case "red"}<p>red</p>{:case "blue"}<p>blue</p>{:default}<p>other</p>{/switch}',
        scope: () => ({ color: 'blue' }),
    },
    {
        name: 'await-block',
        src: '{#await p}<em>…</em>{:then v}<p>{v}</p>{/await}',
        scope: () => ({ p: Promise.resolve('ready') }),
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
]

const MIN_TIME_MS = 120
const MIN_ITERS = 20
const WARMUP = 5

export interface BenchRow {
    name: string
    nsPerOp: number
    iters: number
    rows: number | null
    nsPerRow: number | null
}

export default GET(() => {
    async function* run(): AsyncIterable<BenchRow> {
        for (const scenario of SCENARIOS) {
            const mod = await loadEmittedServer(scenario.src)
            const render = () => mod.render(scenario.scope())

            for (let i = 0; i < WARMUP; i++) await render()

            let iters = 0
            const start = Bun.nanoseconds()
            let elapsed = 0
            const budgetNs = MIN_TIME_MS * 1e6
            do {
                await render()
                iters++
                elapsed = Bun.nanoseconds() - start
            } while (elapsed < budgetNs || iters < MIN_ITERS)

            const nsPerOp = elapsed / iters
            yield {
                name: scenario.name,
                nsPerOp,
                iters,
                rows: scenario.rows ?? null,
                nsPerRow: scenario.rows ? nsPerOp / scenario.rows : null,
            }
            await new Promise((resolve) => setTimeout(resolve, 40))
        }
    }
    return jsonl(run())
})
