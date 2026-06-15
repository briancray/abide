import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { derived } from '../src/lib/ui/derived.ts'
import { doc } from '../src/lib/ui/doc.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { attr } from '../src/lib/ui/dom/attr.ts'
import { awaitBlock } from '../src/lib/ui/dom/awaitBlock.ts'
import { each } from '../src/lib/ui/dom/each.ts'
import { hydrate } from '../src/lib/ui/dom/hydrate.ts'
import { mount } from '../src/lib/ui/dom/mount.ts'
import { on } from '../src/lib/ui/dom/on.ts'
import { openChild } from '../src/lib/ui/dom/openChild.ts'
import { openRoot } from '../src/lib/ui/dom/openRoot.ts'
import { switchBlock } from '../src/lib/ui/dom/switchBlock.ts'
import { text } from '../src/lib/ui/dom/text.ts'
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
    text,
    attr,
    on,
    each,
    when,
    awaitBlock,
    switchBlock,
    mount,
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

describe('slots (component children)', () => {
    const Card = `<div class="card"><slot></slot></div>`
    const parent = `
        <script>let name = state('world')</script>
        <Card>Hello {name}!</Card>
    `

    test('client renders parent markup inside the child slot', () => {
        const host = document.createElement('div')
        component(parent, { Card: component(Card) })(host)
        const html = (
            globalThis as unknown as { serializeMiniDom: (h: unknown) => string }
        ).serializeMiniDom(host)
        expect(html).toBe('<card><div class="card">Hello world!</div></card>')
    })

    test('SSR renders slot content server-side, identical to the client', () => {
        const CardComponent = component(Card)
        const server = component(parent, { Card: CardComponent }).render()
        expect(server.html).toBe('<card><div class="card">Hello world!</div></card>')
    })
})

describe('named slots', () => {
    /* Two named slots (each with fallback content) plus a default slot. */
    const Card = `<div class="card"><header><slot name="header">untitled</slot></header><main><slot></slot></main><footer><slot name="footer"></slot></footer></div>`
    const serialize = (host: unknown): string =>
        (globalThis as unknown as { serializeMiniDom: (h: unknown) => string }).serializeMiniDom(
            host,
        )

    test('routes slotted children to the default + named outlets (SSR == client)', () => {
        const parent = `<section><Card><h1 slot="header">Title</h1><p>body</p><span slot="footer">foot</span></Card></section>`
        const expected =
            '<section><card><div class="card">' +
            '<header><h1>Title</h1></header>' +
            '<main><p>body</p></main>' +
            '<footer><span>foot</span></footer>' +
            '</div></card></section>'
        expect(component(parent, { Card: component(Card) }).render().html).toBe(expected)
        const host = document.createElement('div')
        component(parent, { Card: component(Card) })(host)
        expect(serialize(host)).toBe(expected)
    })

    test('falls back to the slot’s own children when a slot is not provided', () => {
        const parent = `<section><Card><p>body</p></Card></section>`
        expect(component(parent, { Card: component(Card) }).render().html).toBe(
            '<section><card><div class="card">' +
                '<header>untitled</header>' + // fallback content
                '<main><p>body</p></main>' +
                '<footer></footer>' + // no content, no fallback
                '</div></card></section>',
        )
    })

    test('hydrates slotted content in place (adopts, no duplication)', () => {
        const parentSource = `<section><Card><h1 slot="header">Title</h1><p>body</p></Card></section>`
        const Card_ = component(Card)
        const server = component(parentSource, { Card: Card_ }).render()

        const host = document.createElement('div')
        host.innerHTML = server.html
        const section = host.childNodes[0] as unknown as { childNodes: unknown[] }
        const cardDiv = (
            (section.childNodes[0] as unknown as { childNodes: unknown[] })
                .childNodes[0] as unknown as { childNodes: unknown[] }
        ).childNodes[0] as unknown as { childNodes: unknown[] }
        const header = cardDiv.childNodes[0] as unknown as { childNodes: unknown[] }
        const h1Before = header.childNodes[0]

        const runtime = { ...RUNTIME, Card: Card_ }
        const names = Object.keys(runtime)
        const values = names.map((name) => runtime[name as keyof typeof runtime])
        const body = compileComponent(parentSource)
        hydrate(host, (target) => {
            new Function('host', ...names, body)(target, ...values)
        })

        // the slotted <h1> was adopted, not recreated or duplicated
        expect(header.childNodes.length).toBe(1)
        expect(header.childNodes[0]).toBe(h1Before)
        expect(host.textContent).toContain('Title')
        expect(host.textContent).toContain('body')
    })
})
