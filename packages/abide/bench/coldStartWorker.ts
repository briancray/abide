import { enterRenderPass } from '../src/lib/ui/runtime/enterRenderPass.ts'
import { exitRenderPass } from '../src/lib/ui/runtime/exitRenderPass.ts'
import { nextBlockId } from '../src/lib/ui/runtime/nextBlockId.ts'

/* The compiled SSR body references render-pass helpers as bare globals. */
const globals = globalThis as Record<string, unknown>
globals.enterRenderPass = enterRenderPass
globals.exitRenderPass = exitRenderPass
globals.nextBlockId = nextBlockId

const { compileSSR } = await import('../src/lib/ui/compile/compileSSR.ts')
const { createDoc: doc } = await import('../src/lib/ui/runtime/createDoc.ts')
const { state } = await import('../src/lib/ui/state.ts')
const { derived } = await import('../src/lib/ui/derived.ts')
const { effect } = await import('../src/lib/ui/effect.ts')

import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'

/* One realistic page: compile its SSR body then render once — the cold path a
   first request pays. Kept off the parent's clock by running in its own process. */
const PAGE = `
    <script>
        let items = state(
            Array.from({ length: 200 }, (_, index) => ({ id: index, label: 'row-' + index })),
        )
    </script>
    <main>
        <h1>Catalogue</h1>
        <ul>
            <template each={items} as="item" key="item.id">
                <li><span>{item.label}</span> #{item.id}</li>
            </template>
        </ul>
    </main>
`

const body = compileSSR(PAGE)
const result = new Function('doc', 'state', 'derived', 'effect', body)(
    doc,
    state,
    derived,
    effect,
) as SsrRender

/* Touch the output so nothing is dead-code-eliminated. */
if (result.html.length === 0) {
    process.exit(1)
}
