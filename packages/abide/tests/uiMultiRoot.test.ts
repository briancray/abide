import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { derived } from '../src/lib/ui/derived.ts'
import { doc } from '../src/lib/ui/doc.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { each } from '../src/lib/ui/dom/each.ts'
import { hydrate } from '../src/lib/ui/dom/hydrate.ts'
import { mountChild } from '../src/lib/ui/dom/mountChild.ts'
import { on } from '../src/lib/ui/dom/on.ts'
import { openChild } from '../src/lib/ui/dom/openChild.ts'
import { switchBlock } from '../src/lib/ui/dom/switchBlock.ts'
import { when } from '../src/lib/ui/dom/when.ts'
import { effect } from '../src/lib/ui/effect.ts'
import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})

/* A minimal dual child component: callable on the client (mounts a <span> with its
   label, claiming its server markup on hydrate via openChild/appendText), and
   `.render` on the server (the same markup as a string). Stands in for a compiled
   `.abide` child so a component-as-root can be exercised end to end. */
const Button = Object.assign(
    (host: Element, props: { label: () => unknown }): (() => void) => {
        const span = openChild(host, 'span')
        appendText(span, () => props.label())
        return () => {}
    },
    {
        render: (props: { label: () => unknown }): SsrRender => ({
            html: `<span>${String(props.label())}</span>`,
            state: undefined,
            awaits: [],
        }),
    },
)

const RUNTIME = {
    doc,
    state,
    derived,
    effect,
    openChild,
    appendText,
    appendStatic,
    on,
    when,
    each,
    switchBlock,
    mountChild,
    Button,
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
        expect(ssr(IF, doc({ on: true })).html).toBe(
            '<main><!--[--><h1>A</h1><p>B</p><!--]--></main>',
        )
        expect(ssr(IF, doc({ on: false })).html).toBe('<main><!--[--><!--]--></main>')
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
        const main = host.childNodes[0] as unknown as { children: Node[] }
        const [h1Before, pBefore] = [main.children[0], main.children[1]]

        run(IF, host, model, 'hydrate')
        // both roots adopted in place, not recreated (markers bound the range)
        expect(main.children[0]).toBe(h1Before)
        expect(main.children[1]).toBe(pBefore)
        expect(host.textContent).toBe('AB')

        model.replace('on', false)
        expect(host.textContent).toBe('')
        model.replace('on', true)
        expect(host.textContent).toBe('AB')
    })

    test('switch case supports multiple roots', () => {
        const SWITCH = `<main><template switch={model.k}><template case="'a'"><h1>A1</h1><h2>A2</h2></template><template default><span>?</span></template></template></main>`
        expect(ssr(SWITCH, doc({ k: 'a' })).html).toBe(
            '<main><!--[--><h1>A1</h1><h2>A2</h2><!--]--></main>',
        )
        const model = doc({ k: 'a' })
        const host = document.createElement('div')
        run(SWITCH, host, model, 'mount')
        expect(host.textContent).toBe('A1A2')
        model.replace('k', 'z')
        expect(host.textContent).toBe('?')
    })

    test('a component is a valid branch root: SSR, mount, and hydrate agree', () => {
        const SRC = `<main><template if={model.on}><Button label="hi"/></template></main>`
        // a component renders into its wrapper element, both server and client
        expect(ssr(SRC, doc({ on: true })).html).toBe(
            '<main><!--[--><button><span>hi</span></button><!--]--></main>',
        )
        expect(ssr(SRC, doc({ on: false })).html).toBe('<main><!--[--><!--]--></main>')

        // client mount
        const model = doc({ on: true })
        const host = document.createElement('div')
        run(SRC, host, model, 'mount')
        expect(host.textContent).toBe('hi')
        model.replace('on', false)
        expect(host.textContent).toBe('')
        model.replace('on', true)
        expect(host.textContent).toBe('hi')

        // hydrate adopts the server-rendered wrapper in place
        const hModel = doc({ on: true })
        const hHost = document.createElement('div')
        hHost.innerHTML = ssr(SRC, hModel).html
        const wrapperBefore = (hHost.childNodes[0] as unknown as { children: Node[] }).children[0]
        run(SRC, hHost, hModel, 'hydrate')
        expect((hHost.childNodes[0] as unknown as { children: Node[] }).children[0]).toBe(
            wrapperBefore,
        )
        expect(hHost.textContent).toBe('hi')
    })

    test('a component is a valid each row', () => {
        const SRC = `<ul><template each={model.items} as="i" key="i"><Button label={i}/></template></ul>`
        expect(ssr(SRC, doc({ items: ['a', 'b'] })).html).toBe(
            '<ul><!--[--><button><span>a</span></button><!--]--><!--[--><button><span>b</span></button><!--]--></ul>',
        )
        const model = doc({ items: ['a', 'b'] })
        const host = document.createElement('div')
        run(SRC, host, model, 'mount')
        expect(host.textContent).toBe('ab')
    })

    test('static text is a valid branch root: SSR, mount, and hydrate agree', () => {
        const SRC = `<main><template if={model.on}>plain text</template></main>`
        expect(ssr(SRC, doc({ on: true })).html).toBe('<main><!--[-->plain text<!--]--></main>')
        expect(ssr(SRC, doc({ on: false })).html).toBe('<main><!--[--><!--]--></main>')

        const model = doc({ on: true })
        const host = document.createElement('div')
        run(SRC, host, model, 'mount')
        expect(host.textContent).toBe('plain text')
        model.replace('on', false)
        expect(host.textContent).toBe('')
        model.replace('on', true)
        expect(host.textContent).toBe('plain text')

        const hModel = doc({ on: true })
        const hHost = document.createElement('div')
        hHost.innerHTML = ssr(SRC, hModel).html
        run(SRC, hHost, hModel, 'hydrate')
        expect(hHost.textContent).toBe('plain text')
    })

    test('a dynamic interpolation is a valid branch root: SSR, mount, and hydrate agree', () => {
        const SRC = `<main><template if={model.on}>{model.name}!</template></main>`
        expect(ssr(SRC, doc({ on: true, name: 'Ada' })).html).toBe(
            '<main><!--[-->Ada!<!--]--></main>',
        )

        const model = doc({ on: true, name: 'Ada' })
        const host = document.createElement('div')
        run(SRC, host, model, 'mount')
        expect(host.textContent).toBe('Ada!')
        model.replace('name', 'Bo')
        expect(host.textContent).toBe('Bo!')

        const hModel = doc({ on: true, name: 'Ada' })
        const hHost = document.createElement('div')
        hHost.innerHTML = ssr(SRC, hModel).html
        run(SRC, hHost, hModel, 'hydrate')
        expect(hHost.textContent).toBe('Ada!')
        hModel.replace('name', 'Bo')
        expect(hHost.textContent).toBe('Bo!')
    })

    test('a nested control-flow <template> directly in a branch renders (full range model)', () => {
        const SRC = `<main><template if={model.on}><template if={model.b}><span>x</span></template></template></main>`
        expect(ssr(SRC, doc({ on: true, b: true })).html).toBe(
            '<main><!--[--><!--[--><span>x</span><!--]--><!--]--></main>',
        )
        const model = doc({ on: true, b: true })
        const host = document.createElement('div')
        run(SRC, host, model, 'mount')
        expect(host.textContent).toBe('x')
        model.replace('b', false)
        expect(host.textContent).toBe('')
        model.replace('b', true)
        expect(host.textContent).toBe('x')
    })

    /* A bare nested `each` directly in a branch builds with the branch's build
       fragment as its parent; once the branch moves into the document, a reconcile
       must mutate the LIVE parent, not the emptied fragment — else the whole list is
       pulled out of the DOM. */
    test('a bare nested each in a branch reconciles in place after the branch moves', () => {
        const SRC = `<main><template if={model.on}><template each={model.items} as="i" key="i"><b>{i}</b></template></template></main>`
        const model = doc({ on: true, items: ['a', 'b'] })
        const host = document.createElement('div')
        run(SRC, host, model, 'mount')
        const main = host.childNodes[0] as unknown as { children: { textContent: string }[] }
        expect(main.children.map((c) => c.textContent)).toEqual(['a', 'b'])
        model.add('items/-', 'c') // reconcile: append a row
        expect(main.children.map((c) => c.textContent)).toEqual(['a', 'b', 'c'])
        model.replace('items', ['c', 'a']) // reorder + drop 'b'
        expect(main.children.map((c) => c.textContent)).toEqual(['c', 'a'])
    })
})
