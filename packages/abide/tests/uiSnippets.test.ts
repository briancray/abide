import { beforeAll, describe, expect, test } from 'bun:test'
import { snippet } from '../src/lib/shared/snippet.ts'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { derived } from '../src/lib/ui/derived.ts'
import { doc } from '../src/lib/ui/doc.ts'
import { appendSnippet } from '../src/lib/ui/dom/appendSnippet.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { attr } from '../src/lib/ui/dom/attr.ts'
import { each } from '../src/lib/ui/dom/each.ts'
import { hydrate } from '../src/lib/ui/dom/hydrate.ts'
import { mount } from '../src/lib/ui/dom/mount.ts'
import { on } from '../src/lib/ui/dom/on.ts'
import { openChild } from '../src/lib/ui/dom/openChild.ts'
import { openRoot } from '../src/lib/ui/dom/openRoot.ts'
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
    appendSnippet,
    appendStatic,
    attr,
    on,
    each,
    when,
    mount,
    snippet,
}

function component(
    source: string,
    extra: Record<string, unknown> = {},
): ((host: Element, props?: unknown) => void) & { render: (props?: unknown) => SsrRender } {
    const clientBody = compileComponent(source)
    const ssrBody = compileSSR(source)
    const runtime = { ...RUNTIME, ...extra }
    const names = Object.keys(runtime)
    const values = names.map((name) => runtime[name as keyof typeof runtime])
    const fn = (host: Element, props?: unknown) => {
        new Function('host', '$props', ...names, clientBody)(host, props, ...values)
    }
    fn.render = (props?: unknown): SsrRender =>
        new Function('$props', ...names, ssrBody)(props, ...values) as SsrRender
    return fn
}

const serialize = (host: unknown): string =>
    (globalThis as unknown as { serializeMiniDom: (h: unknown) => string }).serializeMiniDom(host)

describe('snippets (<template name args> called like a function)', () => {
    /* A snippet that closes over the component scope (`prefix`) and takes an arg. */
    const source = `
        <script>let prefix = state('#')</script>
        <template name="item" args={label}><li>{prefix}{label}</li></template>
        <ul>{item('a')}{item('b')}</ul>
    `

    test('client mounts the snippet at each call, with args + captured scope', () => {
        const host = document.createElement('div')
        component(source)(host)
        expect(serialize(host)).toBe('<ul><li>#a</li><li>#b</li></ul>')
    })

    test('SSR renders each call between snippet markers', () => {
        const html = component(source).render().html
        expect(html).toBe(
            '<ul>' +
                '<!--abide:snippet--><li>#a</li><!--/abide:snippet-->' +
                '<!--abide:snippet--><li>#b</li><!--/abide:snippet-->' +
                '</ul>',
        )
    })

    test('hydration adopts the server-rendered snippet nodes in place', () => {
        const host = document.createElement('div')
        host.innerHTML = component(source).render().html
        const ul = host.childNodes[0] as unknown as { childNodes: unknown[] }
        const firstLi = ul.childNodes[1] // [0] is the open marker comment

        const clientBody = compileComponent(source)
        const names = Object.keys(RUNTIME)
        const values = names.map((name) => RUNTIME[name as keyof typeof RUNTIME])
        hydrate(host, (target) => {
            new Function('host', ...names, clientBody)(target, ...values)
        })

        expect(ul.childNodes[1]).toBe(firstLi) // adopted, not recreated
        expect(host.textContent).toBe('#a#b')
    })

    test('an object arg destructures (args={{ a, b }})', () => {
        const src = `
            <template name="pair" args={{ a, b }}><span>{a}-{b}</span></template>
            <div>{pair({ a: 1, b: 2 })}</div>
        `
        const host = document.createElement('div')
        component(src)(host)
        expect(serialize(host)).toBe('<div><span>1-2</span></div>')
        expect(component(src).render().html).toBe(
            '<div><!--abide:snippet--><span>1-2</span><!--/abide:snippet--></div>',
        )
    })
})

describe('snippets passed across components', () => {
    /* The parent defines a snippet closing over its own `prefix` and hands it to the
       child as a prop; the child calls it like a function. The body still reads the
       PARENT's scope. */
    const List = `<script>let item = prop('item')</script><ul>{item('x')}{item('y')}</ul>`
    const parent = `
        <script>let prefix = state('•')</script>
        <template name="row" args={label}><li>{prefix}{label}</li></template>
        <List item={row} />
    `

    test('client: child mounts the parent snippet, capturing parent scope', () => {
        const host = document.createElement('div')
        component(parent, { List: component(List) })(host)
        expect(serialize(host)).toBe('<list><ul><li>•x</li><li>•y</li></ul></list>')
    })

    test('SSR: identical, snippet rendered inside the child', () => {
        const html = component(parent, { List: component(List) }).render().html
        expect(html).toBe(
            '<list><ul>' +
                '<!--abide:snippet--><li>•x</li><!--/abide:snippet-->' +
                '<!--abide:snippet--><li>•y</li><!--/abide:snippet-->' +
                '</ul></list>',
        )
    })
})
