import { installMiniDom } from '../tests/support/installMiniDom.ts'

installMiniDom()

const { enterRenderPass } = await import('../src/lib/ui/runtime/enterRenderPass.ts')
const { exitRenderPass } = await import('../src/lib/ui/runtime/exitRenderPass.ts')
const { nextBlockId } = await import('../src/lib/ui/runtime/nextBlockId.ts')
const { mountChild } = await import('../src/lib/ui/dom/mountChild.ts')

/* Compiled bodies reference these as bare globals (the real bundle imports them). */
const globals = globalThis as Record<string, unknown>
globals.enterRenderPass = enterRenderPass
globals.exitRenderPass = exitRenderPass
globals.nextBlockId = nextBlockId
globals.mountChild = mountChild

const { compileComponent } = await import('../src/lib/ui/compile/compileComponent.ts')
const { compileSSR } = await import('../src/lib/ui/compile/compileSSR.ts')
const { doc } = await import('../src/lib/ui/doc.ts')
const { state } = await import('../src/lib/ui/state.ts')
const { derived } = await import('../src/lib/ui/derived.ts')
const { effect } = await import('../src/lib/ui/effect.ts')
const { openChild } = await import('../src/lib/ui/dom/openChild.ts')
const { openRoot } = await import('../src/lib/ui/dom/openRoot.ts')
const { appendText } = await import('../src/lib/ui/dom/appendText.ts')
const { appendStatic } = await import('../src/lib/ui/dom/appendStatic.ts')
const { attr } = await import('../src/lib/ui/dom/attr.ts')
const { each } = await import('../src/lib/ui/dom/each.ts')
const { hydrate } = await import('../src/lib/ui/dom/hydrate.ts')

import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'
import { emitMetric } from './emitMetric.ts'

/*
Hydration benchmark: server-render a list page once, then measure adopting the
server DOM in place (claim existing nodes, wire reactivity) — the cost a returning
user's first interaction waits on. Run:

  bun packages/abide/bench/hydrate.bench.ts
*/

const LIST_PAGE = `
    <script>
        let items = state(
            Array.from({ length: 1000 }, (_, index) => ({ id: index, label: 'row-' + index })),
        )
    </script>
    <main>
        <ul>
            <template each={items} as="item" key="item.id">
                <li class="row"><span>{item.label}</span> #{item.id}</li>
            </template>
        </ul>
    </main>
`

const runtime = {
    doc,
    state,
    derived,
    effect,
    openChild,
    openRoot,
    appendText,
    appendStatic,
    attr,
    each,
}
const names = Object.keys(runtime)
const values = names.map((name) => runtime[name as keyof typeof runtime])

const clientBody = compileComponent(LIST_PAGE)

/* One server render, reused as the DOM every hydration adopts. */
const server = new Function('doc', 'state', 'derived', 'effect', compileSSR(LIST_PAGE))(
    doc,
    state,
    derived,
    effect,
) as SsrRender

function hydrateOnce(): number {
    const host = document.createElement('div')
    host.innerHTML = server.html
    const start = performance.now()
    hydrate(host, (target) => {
        new Function('host', ...names, clientBody)(target, ...values)
    })
    return performance.now() - start
}

console.log(`\nhydration — ${server.html.length} bytes server HTML (1000-row list)\n`)

/* Warm the JIT. */
for (let warm = 0; warm < 20; warm += 1) {
    hydrateOnce()
}

const HYDRATIONS = 500
let total = 0
for (let pass = 0; pass < HYDRATIONS; pass += 1) {
    total += hydrateOnce()
}
console.log(
    `${HYDRATIONS} hydrations          ${total.toFixed(1).padStart(8)}ms` +
        `   ${(total / HYDRATIONS).toFixed(4).padStart(9)}ms/hydration\n`,
)
emitMetric('hydrate.run', total / HYDRATIONS, 'ms/hydration')
