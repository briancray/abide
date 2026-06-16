import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { derived } from '../src/lib/ui/derived.ts'
import { doc } from '../src/lib/ui/doc.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { hydrate } from '../src/lib/ui/dom/hydrate.ts'
import { on } from '../src/lib/ui/dom/on.ts'
import { openChild } from '../src/lib/ui/dom/openChild.ts'
import { openRoot } from '../src/lib/ui/dom/openRoot.ts'
import { switchBlock } from '../src/lib/ui/dom/switchBlock.ts'
import { when } from '../src/lib/ui/dom/when.ts'
import { effect } from '../src/lib/ui/effect.ts'
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
    on,
    when,
    switchBlock,
}

function ssr(source: string, model: unknown): SsrRender {
    const names = [...Object.keys(RUNTIME), 'model']
    const values = [...Object.values(RUNTIME), model]
    return new Function(...names, compileSSR(source))(...values) as SsrRender
}

function run(source: string, host: Element, model: unknown, mode: 'mount' | 'hydrate'): void {
    const names = ['host', ...Object.keys(RUNTIME), 'model']
    const body = compileComponent(source)
    const fn = (target: Element) => {
        new Function(...names, body)(target, ...Object.values(RUNTIME), model)
    }
    if (mode === 'hydrate') {
        hydrate(host, fn)
    } else {
        fn(host)
    }
}

describe('multi-root branches', () => {
    const IF = `<main><template if={model.on}><h1>A</h1><p>B</p></template></main>`

    test('SSR renders all branch roots, no wrapper', () => {
        expect(ssr(IF, doc({ on: true })).html).toBe('<main><h1>A</h1><p>B</p></main>')
        expect(ssr(IF, doc({ on: false })).html).toBe('<main></main>')
    })

    test('client mounts all roots, and toggling adds/removes the whole range', () => {
        const model = doc({ on: true })
        const host = document.createElement('div')
        run(IF, host, model, 'mount')
        const main = host.childNodes[0] as unknown as { childNodes: { tagName?: string }[] }
        expect(main.childNodes.map((n) => n.tagName).filter(Boolean)).toEqual(['h1', 'p'])

        model.replace('on', false)
        expect(main.childNodes.map((n) => n.tagName).filter(Boolean)).toEqual([])
        model.replace('on', true)
        expect(main.childNodes.map((n) => n.tagName).filter(Boolean)).toEqual(['h1', 'p'])
    })

    test('hydration adopts every root in place, then toggles', () => {
        const model = doc({ on: true })
        const host = document.createElement('div')
        host.innerHTML = ssr(IF, model).html
        const main = host.childNodes[0] as unknown as { childNodes: { tagName?: string }[] }
        const [h1Before, pBefore] = [main.childNodes[0], main.childNodes[1]]

        run(IF, host, model, 'hydrate')
        // both roots adopted, not recreated
        expect(main.childNodes[0]).toBe(h1Before)
        expect(main.childNodes[1]).toBe(pBefore)
        expect(host.textContent).toBe('AB')

        model.replace('on', false)
        expect(host.textContent).toBe('')
        model.replace('on', true)
        expect(host.textContent).toBe('AB')
    })

    test('switch case supports multiple roots', () => {
        const SWITCH = `<main><template switch={model.k}><template case="'a'"><h1>A1</h1><h2>A2</h2></template><template default><span>?</span></template></template></main>`
        expect(ssr(SWITCH, doc({ k: 'a' })).html).toBe('<main><h1>A1</h1><h2>A2</h2></main>')
        const model = doc({ k: 'a' })
        const host = document.createElement('div')
        run(SWITCH, host, model, 'mount')
        expect(host.textContent).toBe('A1A2')
        model.replace('k', 'z')
        expect(host.textContent).toBe('?')
    })

    test('non-element branch content is a clear compile error', () => {
        expect(() =>
            compileComponent(`<main><template if={model.on}>plain text</template></main>`),
        ).toThrow('content must be element')
    })
})
