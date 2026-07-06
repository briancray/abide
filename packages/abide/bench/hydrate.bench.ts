import { installMiniDom } from '../tests/support/installMiniDom.ts'

installMiniDom()

/* Sets the bare render-pass globals (scope, enterRenderPass, exitRenderPass,
   nextBlockId, skeleton, anchorCursor, mountSlot, appendTextAt, cloneStatic,
   mountChild, …) the compiled server and client bodies reference by name, and
   keeps the block-id counter shared between the server render and the client
   hydrate so the hydration cursor adopts. Registers the `.abide` loader plugin. */
import '../tests/support/uiPreload.ts'

const { compileComponent } = await import('../src/lib/ui/compile/compileComponent.ts')
const { compileSSR } = await import('../src/lib/ui/compile/compileSSR.ts')
const { createDoc: doc } = await import('../src/lib/ui/runtime/createDoc.ts')
const { state } = await import('../src/lib/ui/state.ts')
const { computed } = await import('../src/lib/ui/computed.ts')
const { effect } = await import('../src/lib/ui/effect.ts')
const { appendText } = await import('../src/lib/ui/dom/appendText.ts')
const { appendStatic } = await import('../src/lib/ui/dom/appendStatic.ts')
const { attr } = await import('../src/lib/ui/dom/attr.ts')
const { on } = await import('../src/lib/ui/dom/on.ts')
const { each } = await import('../src/lib/ui/dom/each.ts')
const { when } = await import('../src/lib/ui/dom/when.ts')
const { cloneStatic } = await import('../src/lib/ui/dom/cloneStatic.ts')
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
        import { state } from '@abide/abide/ui/state'
        let items = state(
            Array.from({ length: 1000 }, (_, index) => ({ id: index, label: 'row-' + index })),
        )
    </script>
    <main>
        <ul>
            {#for item of items by item.id}
                <li class="row"><span>{item.label}</span> #{item.id}</li>
            {/for}
        </ul>
    </main>
`

const runtime = {
    doc,
    state,
    computed,
    effect,
    appendText,
    appendStatic,
    attr,
    on,
    each,
    when,
    cloneStatic,
}
const names = Object.keys(runtime)
const values = names.map((name) => runtime[name as keyof typeof runtime])

const clientBody = compileComponent(LIST_PAGE)

/* One server render, reused as the DOM every hydration adopts. */
const server = new Function('doc', 'state', 'computed', 'effect', compileSSR(LIST_PAGE))(
    doc,
    state,
    computed,
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
