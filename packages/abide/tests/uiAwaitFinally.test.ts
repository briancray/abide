import { beforeAll, describe, expect, test } from 'bun:test'
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
}

/* Mount a component on the client and return its host. */
function mount(source: string, model: unknown): HTMLElement {
    const host = document.createElement('div')
    new Function('host', ...Object.keys(RUNTIME), 'model', compileComponent(source))(
        host,
        ...Object.values(RUNTIME),
        model,
    )
    return host
}

/* Run the component's SSR render and stream it to one HTML string. */
async function ssrStream(source: string, model: unknown): Promise<string> {
    const render = new Function(...Object.keys(RUNTIME), 'model', compileSSR(source))(
        ...Object.values(RUNTIME),
        model,
    ) as SsrRender
    let html = ''
    for await (const chunk of renderToStream(() => render)) {
        html += chunk
    }
    return html
}

const FULL = `<main><template await={model.load}>
    <p>loading</p>
    <template then="v"><span>{v}</span></template>
    <template catch="e"><b>{e}</b></template>
    <template finally><i>done</i></template>
</template></main>`

describe('<template finally>', () => {
    test('client: pending shows neither outcome nor finally', () => {
        const host = mount(FULL, doc({ load: Promise.resolve('ok') }))
        expect(host.textContent).toBe('loading')
    })

    test('client: resolve renders then ++ finally as one range', async () => {
        const host = mount(FULL, doc({ load: Promise.resolve('ok') }))
        await Promise.resolve()
        await Promise.resolve()
        expect(host.textContent).toBe('okdone')
    })

    test('client: reject renders catch ++ finally', async () => {
        const host = mount(FULL, doc({ load: Promise.reject('boom') }))
        await Promise.resolve()
        await Promise.resolve()
        expect(host.textContent).toBe('boomdone')
    })

    test('finally-only (no then/catch) renders on both outcomes', async () => {
        const ONLY = `<main><template await={model.load}><p>loading</p><template finally><i>done</i></template></template></main>`
        const ok = mount(ONLY, doc({ load: Promise.resolve('x') }))
        const bad = mount(ONLY, doc({ load: Promise.reject('y') }))
        await Promise.resolve()
        await Promise.resolve()
        expect(ok.textContent).toBe('done')
        expect(bad.textContent).toBe('done')
    })

    test('SSR streams the resolved branch with finally appended', async () => {
        const html = await ssrStream(FULL, doc({ load: Promise.resolve('ok') }))
        expect(html).toContain('<span>ok</span><i>done</i>')
    })

    test('hydration adopts then ++ finally in place', async () => {
        const model = doc({ load: Promise.resolve('ok') })
        const streamed = await ssrStream(FULL, model)
        // the resolved fragment the swap script would inline into the boundary
        const resolved = streamed.match(
            /<abide-resolve[^>]*><script[^>]*>[\s\S]*?<\/script>([\s\S]*?)<\/abide-resolve>/,
        )?.[1]
        expect(resolved).toBe('<span>ok</span><i>done</i>')
    })
})
