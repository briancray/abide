import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { hydrate } from '../src/lib/ui/dom/hydrate.ts'
import { on } from '../src/lib/ui/dom/on.ts'
import { SVG_NAMESPACE } from '../src/lib/ui/dom/SVG_NAMESPACE.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { html } from '../src/lib/ui/html.ts'
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
    on,
    html,
}

function ssr(source: string, $$model: unknown): SsrRender {
    const names = [...Object.keys(RUNTIME), '$$model']
    return new Function(...names, compileSSR(source))(
        ...Object.values(RUNTIME),
        $$model,
    ) as SsrRender
}

function run(source: string, host: Element, $$model: unknown, mode: 'mount' | 'hydrate'): void {
    const names = ['host', ...Object.keys(RUNTIME), '$$model']
    const body = compileComponent(source)
    const fn = (target: Element) => {
        new Function(...names, body)(target, ...Object.values(RUNTIME), $$model)
    }
    mode === 'hydrate' ? hydrate(host, fn) : fn(host)
}

describe('html`` raw markup via {expr}', () => {
    test('the html tag brands a value (plain call + tagged)', () => {
        // a {expr} of a branded value inserts raw; a plain string escapes
        const src = `<div>{$$model.code}</div>`
        const out = ssr(src, doc({ code: html('<b>hi</b>') })).html
        expect(out).toBe('<div><!--abide:html--><b>hi</b><!--/abide:html--></div>')

        const escaped = ssr(src, doc({ code: '<b>hi</b>' })).html
        expect(escaped).toBe('<div>&lt;b&gt;hi&lt;/b&gt;</div>') // plain string stays escaped
    })

    test('tagged form concatenates parts verbatim', () => {
        const out = ssr(`<div>{$$model.row}</div>`, doc({ row: html`<b>${'x'}</b>` })).html
        expect(out).toBe('<div><!--abide:html--><b>x</b><!--/abide:html--></div>')
    })

    test('a plain call with a nullish argument renders empty (bare async read while pending)', () => {
        /* ADR-0032: a bare async read hands `html()` `undefined` while pending
           (`{html(highlight(code)?.html)}`), so the plain-call path degrades to empty raw
           instead of throwing on `strings[0]` — mirroring `{value}`'s `undefined` → `""`. */
        expect(html(undefined)).toEqual(html(''))
        expect(html(null)).toEqual(html(''))
        const out = ssr(`<div>{$$model.code}</div>`, doc({ code: html(undefined) })).html
        expect(out).toBe('<div><!--abide:html--><!--/abide:html--></div>')
    })

    test('client mount parses branded markup into real nodes', () => {
        const host = document.createElement('div')
        run(`<div>{$$model.code}</div>`, host, doc({ code: html('<b>hi</b>') }), 'mount')
        const box = host.childNodes[0] as unknown as { childNodes: { tagName?: string }[] }
        expect(box.childNodes.map((n) => n.tagName).filter(Boolean)).toEqual(['b'])
        expect(host.textContent).toBe('hi')
    })

    test('hydration adopts the server markup, then re-parses on change', () => {
        const $$model = doc({ code: html('<b>one</b><i>two</i>') })
        const host = document.createElement('div')
        host.innerHTML = ssr(`<div>{$$model.code}</div>`, $$model).html
        const box = host.childNodes[0] as unknown as { childNodes: { textContent: string }[] }
        const bBefore = box.childNodes[1] // [0] is the open marker comment

        run(`<div>{$$model.code}</div>`, host, $$model, 'hydrate')
        expect(box.childNodes[1]).toBe(bBefore) // adopted, not recreated
        expect(host.textContent).toBe('onetwo')

        $$model.replace('code', html('<span>new</span>'))
        expect(host.textContent).toBe('new')
    })

    test('raw markup inside <svg> parses in the SVG namespace, on mount and on change', () => {
        // An icon component: SVG inner markup injected via {html()} into an <svg> parent.
        // The bare <path> must land in the SVG namespace or it renders as nothing.
        const src = `<svg>{$$model.icon}</svg>`
        const host = document.createElement('div')
        const $$model = doc({ icon: html('<path d="M1 1"/>') })
        run(src, host, $$model, 'mount')

        const svg = host.childNodes[0] as unknown as { childNodes: { namespaceURI?: string }[] }
        const path = svg.childNodes.find((n) => n.namespaceURI !== undefined)
        expect(path?.namespaceURI).toBe(SVG_NAMESPACE)

        // The client re-parse path (set on change) must keep the namespace too.
        $$model.replace('icon', html('<circle r="2"/>'))
        const circle = svg.childNodes.find((n) => n.namespaceURI !== undefined)
        expect(circle?.namespaceURI).toBe(SVG_NAMESPACE)
    })
})
