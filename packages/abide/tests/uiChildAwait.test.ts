import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { derived } from '../src/lib/ui/derived.ts'
import { doc } from '../src/lib/ui/doc.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { awaitBlock } from '../src/lib/ui/dom/awaitBlock.ts'
import { mount } from '../src/lib/ui/dom/mount.ts'
import { openChild } from '../src/lib/ui/dom/openChild.ts'
import { openRoot } from '../src/lib/ui/dom/openRoot.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { renderToStream } from '../src/lib/ui/renderToStream.ts'
import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})

const RUNTIME = {
    doc,
    state,
    derived,
    effect,
    openChild,
    openRoot,
    appendText,
    appendStatic,
    awaitBlock,
    mount,
}

function component(source: string, extra: Record<string, unknown> = {}) {
    const clientBody = compileComponent(source)
    const ssrBody = compileSSR(source)
    const runtime = { ...RUNTIME, ...extra }
    const names = Object.keys(runtime)
    const values = names.map((name) => runtime[name as keyof typeof runtime])
    const fn = (host: Element, props?: unknown) =>
        new Function('host', '$props', ...names, clientBody)(host, props, ...values)
    fn.render = (props?: unknown): SsrRender =>
        new Function('$props', ...names, ssrBody)(props, ...values) as SsrRender
    return fn
}

async function streamToString(render: () => SsrRender): Promise<string> {
    let html = ''
    for await (const chunk of renderToStream(render)) {
        html += chunk
    }
    return html
}

describe('child-component await blocks join the page SSR stream', () => {
    const Child = component(`
        <script>let inner = state(Promise.resolve('C'))</script>
        <template await={inner}><p>child-pending</p><template then="c"><span>child:{c}</span></template></template>
    `)
    const Parent = component(
        `
        <script>let top = state(Promise.resolve('T'))</script>
        <div>
            <template await={top}><p>top-pending</p><template then="t"><b>top:{t}</b></template></template>
            <Child />
        </div>
    `,
        { Child },
    )

    test('the parent stream carries BOTH the page and the child resolved fragments', async () => {
        const html = await streamToString(() => Parent.render())
        // the child's await resolved server-side — only possible if its awaits merged
        expect(html).toContain('top:T')
        expect(html).toContain('child:C')
    })

    test('the page and child awaits get distinct, non-colliding ids', async () => {
        const html = await streamToString(() => Parent.render())
        const ids = [...html.matchAll(/<abide-resolve data-id="(\d+)"/g)].map((m) => m[1]).sort()
        expect(ids).toEqual(['0', '1']) // two boundaries, unique ids — no RESUME collision
    })

    test('a second render pass resets the counter (ids start at 0 again)', async () => {
        await streamToString(() => Parent.render())
        const html = await streamToString(() => Parent.render())
        const ids = [...html.matchAll(/<abide-resolve data-id="(\d+)"/g)].map((m) => m[1]).sort()
        expect(ids).toEqual(['0', '1'])
    })
})
