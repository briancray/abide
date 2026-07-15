import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { pendingAsyncCellsSlot } from '../src/lib/shared/pendingAsyncCellsSlot.ts'
import type { PendingAsyncCells } from '../src/lib/shared/types/PendingAsyncCells.ts'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { awaitBlock } from '../src/lib/ui/dom/awaitBlock.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { renderToStream } from '../src/lib/ui/renderToStream.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'
import { settle } from './support/settle.ts'

beforeAll(() => {
    installMiniDom()
})

/* Give each test its OWN async-cell pending list (as a request scope does) — otherwise the SSR
   barrier's fixpoint drain would await never-settling deferreds other suites leave on the shared
   module-singleton fallback and hang (see ssrAsyncCell.test.ts). */
let previousResolver: (() => PendingAsyncCells | undefined) | undefined
beforeEach(() => {
    previousResolver = pendingAsyncCellsSlot.resolver
    const list: PendingAsyncCells = { promises: [] }
    pendingAsyncCellsSlot.resolver = () => list
})
afterEach(() => {
    pendingAsyncCellsSlot.resolver = previousResolver
})

const RUNTIME = { doc, state, computed, effect, appendText, appendStatic, awaitBlock }

/* Mount a component on the client (cold — no hydration cursor). `load` is the free
   helper the script's cell seed calls. */
function mount(source: string, load: () => unknown): HTMLElement {
    const host = document.createElement('div')
    new Function('host', ...Object.keys(RUNTIME), 'load', compileComponent(source))(
        host,
        ...Object.values(RUNTIME),
        load,
    )
    return host
}

/* Full SSR stream to one HTML string — exercises the real `renderToStream` await drain. */
async function ssrStream(source: string, load: () => unknown): Promise<string> {
    const render = new Function(...Object.keys(RUNTIME), 'load', compileSSR(source))(
        ...Object.values(RUNTIME),
        load,
    ) as SsrRender
    let html = ''
    for await (const chunk of renderToStream(() => render)) {
        html += chunk
    }
    return html
}

/* ADR-0047: `{#await <cell>}` awaits the cell's resolution — the whole point of the block —
   instead of peeking its `undefined`-while-pending value and firing `{:then}` with `undefined`.
   The subject is a `computed` async cell; the block shows pending, then the value. */
const SOURCE = `<script>
import { state } from '@abide/abide/ui/state'
const data = state.computed(load())
</script>
{#await data}<p>loading…</p>{:then d}<p>got {d.n}</p>{:catch e}<p>err {e.message}</p>{/await}`

describe('{#await <cell>} awaits the cell subject (ADR-0047)', () => {
    test('client cold mount: shows the pending branch, then the resolved value', async () => {
        const host = mount(SOURCE, () => Promise.resolve({ n: 7 }))
        /* Pending first — NOT `got ` with an undefined member (the pre-fix crash/blank). */
        expect(host.textContent).toContain('loading…')
        expect(host.textContent).not.toContain('got')
        await settle()
        expect(host.textContent).toContain('got 7')
    })

    test('SSR stream: the resolved {:then} value bakes into the streamed HTML', async () => {
        const html = await ssrStream(SOURCE, () => Promise.resolve({ n: 42 }))
        expect(html).toContain('got 42')
        expect(html).not.toContain('got </p>')
    })

    test('client cold mount: an errored cell subject shows the {:catch} branch', async () => {
        /* An `await` async cell (its error lands in `error()`, no trackedComputed promise-probe). */
        const asyncSource = `<script>
import { state } from '@abide/abide/ui/state'
const data = state.computed(await load())
</script>
{#await data}<p>loading…</p>{:then d}<p>got {d.n}</p>{:catch e}<p>err {e.message}</p>{/await}`
        const host = mount(asyncSource, () => Promise.reject(new Error('nope')))
        await settle()
        expect(host.textContent).toContain('err nope')
        expect(host.textContent).not.toContain('got')
    })
})
