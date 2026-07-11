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

beforeAll(() => {
    installMiniDom()
})

const RUNTIME = {
    doc,
    state,
    computed,
    effect,
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
    /* `$ctx` (the request-local block-id counter) is threaded so a child shares the
       page's depth-first numbering; the page render passes it when inlining the child. */
    fn.render = (props?: unknown, ctx?: unknown): SsrRender | Promise<SsrRender> =>
        new Function('$props', '$ctx', ...names, ssrBody)(props, ctx, ...values) as
            | SsrRender
            | Promise<SsrRender>
    return fn
}

async function streamToString(render: () => SsrRender | Promise<SsrRender>): Promise<string> {
    let html = ''
    for await (const chunk of renderToStream(render)) {
        html += chunk
    }
    return html
}

describe('child-component await blocks join the page SSR stream', () => {
    const Child = component(`
        <script>import { state } from '@abide/abide/ui/state'
let inner = state(Promise.resolve('C'))</script>
        {#await inner}<p>child-pending</p>{:then c}<span>child:{c}</span>{/await}
    `)
    const Parent = component(
        `
        <script>import { state } from '@abide/abide/ui/state'
let top = state(Promise.resolve('T'))</script>
        <div>
            {#await top}<p>top-pending</p>{:then t}<b>top:{t}</b>{/await}
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
        const ids = [...html.matchAll(/<abide-resolve data-id="([^"]+)"/g)].map((m) => m[1]).sort()
        expect(ids).toEqual(['0', '0:0']) // two boundaries, unique ids — no RESUME collision
    })

    test('a second render pass resets the counter (ids start at 0 again)', async () => {
        await streamToString(() => Parent.render())
        const html = await streamToString(() => Parent.render())
        const ids = [...html.matchAll(/<abide-resolve data-id="([^"]+)"/g)].map((m) => m[1]).sort()
        expect(ids).toEqual(['0', '0:0'])
    })
})
