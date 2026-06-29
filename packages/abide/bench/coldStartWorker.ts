import { enterScope } from '../src/lib/ui/enterScope.ts'
import { exitScope } from '../src/lib/ui/exitScope.ts'
import { enterRenderPass } from '../src/lib/ui/runtime/enterRenderPass.ts'
import { exitRenderPass } from '../src/lib/ui/runtime/exitRenderPass.ts'
import { nextBlockId } from '../src/lib/ui/runtime/nextBlockId.ts'
import { scope } from '../src/lib/ui/scope.ts'

/* The compiled SSR body references render-pass + scope helpers as globals under the
   compiler's reserved `$$` injected namespace (see UI_RUNTIME_IMPORTS aliases), so
   install them under those exact names — a bare `scope`/`enterScope` would leave the
   body's `$$scope`/`$$enterScope` undefined. */
const globals = globalThis as Record<string, unknown>
globals.$$enterRenderPass = enterRenderPass
globals.$$exitRenderPass = exitRenderPass
globals.$$nextBlockId = nextBlockId
globals.$$scope = scope
globals.$$enterScope = enterScope
globals.$$exitScope = exitScope

const { compileSSR } = await import('../src/lib/ui/compile/compileSSR.ts')
const { createDoc: doc } = await import('../src/lib/ui/runtime/createDoc.ts')
const { state } = await import('../src/lib/ui/state.ts')
const { computed } = await import('../src/lib/ui/computed.ts')
const { effect } = await import('../src/lib/ui/effect.ts')

import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'

/* One realistic page: compile its SSR body then render once — the cold path a
   first request pays. Kept off the parent's clock by running in its own process. */
const PAGE = `
    <script>
        let items = scope().state(
            Array.from({ length: 200 }, (_, index) => ({ id: index, label: 'row-' + index })),
        )
    </script>
    <main>
        <h1>Catalogue</h1>
        <ul>
            {#for item of items by item.id}
                <li><span>{item.label}</span> #{item.id}</li>
            {/for}
        </ul>
    </main>
`

const body = compileSSR(PAGE)
const result = new Function('doc', 'state', 'computed', 'effect', body)(
    doc,
    state,
    computed,
    effect,
) as SsrRender

/* Touch the output so nothing is dead-code-eliminated. */
if (result.html.length === 0) {
    process.exit(1)
}
