import { describe, expect, test } from 'bun:test'
import { analyzeComponent } from '../src/lib/ui/compile/analyzeComponent.ts'
import { generateBuild } from '../src/lib/ui/compile/generateBuild.ts'
import { generateSSR } from '../src/lib/ui/compile/generateSSR.ts'

/*
A structural parity harness at the generator interface — the seam the two back-ends
are most likely to silently diverge at (a new node kind added to one walk but not
the other, returning `''` instead of emitting). The end-to-end suites only catch
divergence when rendered output differs; this pins it at the interface.

Each fixture isolates one node/attribute kind and declares which side(s) should
emit code. Two invariants:

  • Coverage parity — a generator emits non-empty code iff it should render the
    kind. A kind handled by build but silently dropped by SSR (or vice versa)
    flips a flag and fails here, not downstream.
  • Lowering parity — a dynamic expression in a position BOTH render lowers to the
    same doc-API call on both sides (the shared `lowerContext`). The two known
    asymmetries are encoded, not assumed away: SSR strips event handlers (no
    listeners server-side) and drops async-`each` rows (an infinite stream would
    hang SSR).
*/

type Side = 'render' | 'empty'

type Fixture = {
    name: string
    source: string
    build: Side
    ssr: Side
    /* A lowered substring that must appear on every side that renders the fixture. */
    loweredBoth?: string
    /* A lowered substring only the client build emits (SSR strips it). */
    loweredBuildOnly?: string
}

const FIXTURES: Fixture[] = [
    {
        name: 'text interpolation',
        source: `<script>let count = scope().state(1)</script><p>{count}</p>`,
        build: 'render',
        ssr: 'render',
        loweredBoth: 'model.read("count")',
    },
    {
        name: 'static element',
        source: `<div class="box"></div>`,
        build: 'render',
        ssr: 'render',
    },
    {
        name: 'expression attribute',
        source: `<script>let count = scope().state(1)</script><div title={count}></div>`,
        build: 'render',
        ssr: 'render',
        loweredBoth: 'model.read("count")',
    },
    {
        name: 'event handler (build-only lowering)',
        source: `<script>let count = scope().state(1)</script><button onclick={count = 2}>x</button>`,
        build: 'render',
        ssr: 'render',
        loweredBuildOnly: 'model.replace("count"',
    },
    {
        name: 'two-way bind',
        source: `<script>let v = scope().state('')</script><input bind:value={v} />`,
        build: 'render',
        ssr: 'render',
    },
    {
        name: 'group bind',
        source: `<script>let choice = scope().state('a')</script><input type="radio" bind:group={choice} value="a" />`,
        build: 'render',
        ssr: 'render',
    },
    {
        name: 'if',
        source: `<script>let count = scope().state(1)</script>{#if count}<p>x</p>{/if}`,
        build: 'render',
        ssr: 'render',
        loweredBoth: 'model.read("count")',
    },
    {
        name: 'switch / case',
        source: `<script>let k = scope().state('a')</script>{#switch k}{:case 'a'}<p>A</p>{/switch}`,
        build: 'render',
        ssr: 'render',
        loweredBoth: 'model.read("k")',
    },
    {
        name: 'each (sync)',
        source: `<script>let items = scope().state([1, 2])</script>{#for it of items by it}<li>{it}</li>{/for}`,
        build: 'render',
        ssr: 'render',
        loweredBoth: 'model.read("items")',
    },
    {
        name: 'each (async) — SSR drops the rows',
        source: `<script>let stream = scope().state([])</script>{#for await n of stream by n}<li>{n}</li>{/for}`,
        build: 'render',
        ssr: 'empty',
    },
    {
        name: 'await (streaming)',
        source: `<script>let p = scope().state(Promise.resolve(1))</script>{#await p}<span>loading</span>{:then v}<b>{v}</b>{/await}`,
        build: 'render',
        ssr: 'render',
        loweredBoth: 'model.read("p")',
    },
    {
        name: 'await (blocking)',
        source: `<script>let p = scope().state(Promise.resolve(1))</script>{#await p then v}<b>{v}</b>{/await}`,
        build: 'render',
        ssr: 'render',
        loweredBoth: 'model.read("p")',
    },
    {
        name: 'try / catch',
        source: `{#try}<p>ok</p>{:catch e}<p>bad</p>{/try}`,
        build: 'render',
        ssr: 'render',
    },
    {
        name: 'component',
        source: `<Child name="x" />`,
        build: 'render',
        ssr: 'render',
    },
    {
        name: 'snippet declaration + call',
        source: `{#snippet item(label)}<li>{label}</li>{/snippet}<ul>{item('a')}</ul>`,
        build: 'render',
        ssr: 'render',
    },
    {
        name: 'slot',
        source: `{children()}`,
        build: 'render',
        ssr: 'render',
    },
    {
        name: 'nested script in element subtree',
        source: `<div><script>let local = scope().state(1)</script><p>{local}</p></div>`,
        build: 'render',
        ssr: 'render',
    },
]

describe('generator parity — build ↔ SSR at the node-walk seam', () => {
    for (const fixture of FIXTURES) {
        test(fixture.name, () => {
            const { stateNames, derivedNames, computedNames, nodes } = analyzeComponent(
                fixture.source,
            )
            const build = generateBuild(nodes, 'host', stateNames, derivedNames, computedNames)
            const ssr = generateSSR(nodes, stateNames, derivedNames, computedNames)

            // coverage: each generator emits iff it should render the kind
            expect(build.trim() !== '').toBe(fixture.build === 'render')
            expect(ssr.trim() !== '').toBe(fixture.ssr === 'render')

            // lowering parity: shared expressions lower the same way on both sides
            if (fixture.loweredBoth !== undefined) {
                if (fixture.build === 'render') {
                    expect(build).toContain(fixture.loweredBoth)
                }
                if (fixture.ssr === 'render') {
                    expect(ssr).toContain(fixture.loweredBoth)
                }
            }

            // SSR strips client-only lowering (event handlers)
            if (fixture.loweredBuildOnly !== undefined) {
                expect(build).toContain(fixture.loweredBuildOnly)
                expect(ssr).not.toContain(fixture.loweredBuildOnly)
            }
        })
    }
})
