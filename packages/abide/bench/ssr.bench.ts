/* Sets the bare render-pass globals (enterRenderPass, exitRenderPass, nextBlockId,
   scope, …) the compiled SSR body references by name, and registers the `.abide`
   loader plugin. */
import '../tests/support/uiPreload.ts'

const { compileSSR } = await import('../src/lib/ui/compile/compileSSR.ts')
const { createDoc: doc } = await import('../src/lib/ui/runtime/createDoc.ts')
const { state } = await import('../src/lib/ui/state.ts')
const { computed } = await import('../src/lib/ui/computed.ts')
const { effect } = await import('../src/lib/ui/effect.ts')

import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'
import { emitMetric } from './emitMetric.ts'

/*
SSR throughput benchmark: how fast the compiled server `render()` assembles HTML
for a list-heavy page. The generator emits string segments + `join('')` (not a
tree), so this measures push-count and join cost — the gate for whether static-run
coalescing in generateSSR earns its keep. Run:

  bun packages/abide/bench/ssr.bench.ts
*/

const LIST_PAGE = `
    <script>
        let items = scope().state(
            Array.from({ length: 1000 }, (_, index) => ({ id: index, label: 'row-' + index })),
        )
    </script>
    <main>
        <h1>Catalogue</h1>
        <ul>
            <template each={items} as="item" key="item.id">
                <li class="row"><span class="label">{item.label}</span> #{item.id}</li>
            </template>
        </ul>
    </main>
`

/* Builds a server render() from a component's compiled SSR body. */
function renderer(source: string): () => SsrRender {
    const body = compileSSR(source)
    return () =>
        new Function('doc', 'state', 'computed', 'effect', body)(
            doc,
            state,
            computed,
            effect,
        ) as SsrRender
}

function ms(start: number): number {
    return performance.now() - start
}

const render = renderer(LIST_PAGE)

/* Warm + sanity-check the byte size of one render. */
const sample = render()
console.log(`\nSSR throughput — ${sample.html.length} bytes/render (1000-row list)\n`)
for (let warm = 0; warm < 200; warm += 1) {
    render()
}

const RENDERS = 5_000
const start = performance.now()
let sink = 0
for (let pass = 0; pass < RENDERS; pass += 1) {
    sink += render().html.length
}
const elapsed = ms(start)
console.log(
    `${RENDERS} renders            ${elapsed.toFixed(1).padStart(8)}ms` +
        `   ${(elapsed / RENDERS).toFixed(4).padStart(9)}ms/render` +
        (sink === -1 ? ' (impossible)' : ''),
)
emitMetric('ssr.render', elapsed / RENDERS, 'ms/render')
console.log()
