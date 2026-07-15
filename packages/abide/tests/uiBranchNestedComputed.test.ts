import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { awaitBlock } from '../src/lib/ui/dom/awaitBlock.ts'
import { mount } from '../src/lib/ui/dom/mount.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { renderToStream } from '../src/lib/ui/renderToStream.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'

/*
Regression: a nested `<script>` INSIDE an `{#await}` branch declaring a computed over the
branch binding (`{:then names}` + `let total = state.computed(names.length)`) — the
kitchen-sink templating/async live demo. The streamed `then` renderer runs the nested
script server-side; the computed's seed must reach `computed()` as a THUNK, not the raw
value, or `readNode` later calls `node.compute?.()` on a number (`node.compute is 3`) and
the whole stream dies mid-drain — a blank page after the shell.
*/

beforeAll(() => {
    installMiniDom()
})

const RUNTIME = { doc, state, computed, effect, appendText, appendStatic, awaitBlock, mount }

function component(source: string, extra: Record<string, unknown> = {}) {
    const clientBody = compileComponent(source)
    const ssrBody = compileSSR(source)
    const runtime = { ...RUNTIME, ...extra }
    const names = Object.keys(runtime)
    const values = names.map((name) => runtime[name as keyof typeof runtime])
    const fn = (host: Element, props?: unknown) =>
        new Function('host', '$props', ...names, clientBody)(host, props, ...values)
    fn.render = (props?: unknown, ctx?: unknown): SsrRender | Promise<SsrRender> =>
        new Function('$props', '$ctx', ...names, ssrBody)(props, ctx, ...values) as
            | SsrRender
            | Promise<SsrRender>
    return Object.assign(fn, { build: fn })
}

async function streamToString(render: () => SsrRender | Promise<SsrRender>): Promise<string> {
    let html = ''
    for await (const chunk of renderToStream(render)) {
        html += chunk
    }
    return html
}

describe('a branch-nested <script> computed over the branch binding', () => {
    test('streams the resolved branch with the computed value (no mid-drain crash)', async () => {
        const render = component(`
            <script>
                function loadNames() {
                    return new Promise((resolve) => setTimeout(() => resolve(['ada', 'lin', 'mo']), 5))
                }
            </script>
            {#await loadNames()}
                <p>loading…</p>
            {:then names}
                <script>
                    let total = state.computed(names.length)
                </script>
                <p>{total} names: {names.join(', ')}</p>
            {:catch error}
                <p>failed</p>
            {/await}
        `).render
        const html = await streamToString(() => render())
        expect(html).toContain('3 names: ada, lin, mo')
    })

    test('a branch-nested linked over the branch binding seeds and renders', async () => {
        const render = component(`
            <script>
                function loadNames() {
                    return new Promise((resolve) => setTimeout(() => resolve(['ada', 'lin']), 5))
                }
            </script>
            {#await loadNames()}
                <p>loading…</p>
            {:then names}
                <script>
                    let draft = state.linked(names.length)
                </script>
                <p>draft {draft}</p>
            {/await}
        `).render
        const html = await streamToString(() => render())
        expect(html).toContain('draft 2')
    })
})

describe('bare seeds handed to the runtime primitives directly', () => {
    test('computed(value) is a constant computed, not a crash', () => {
        const cell = computed(3 as unknown as () => number)
        expect((cell as { value: number }).value).toBe(3)
    })

    test('computed(promise) becomes a streaming async cell', async () => {
        const cell = computed(Promise.resolve('v') as unknown as () => string)
        const probe = cell as unknown as { peek: () => unknown; pending: () => boolean }
        expect(typeof probe.peek).toBe('function')
        await new Promise((resolve) => setTimeout(resolve, 1))
        expect(probe.peek()).toBe('v')
    })
})
