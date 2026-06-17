import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { scopeCss } from '../src/lib/ui/compile/scopeCss.ts'
import { derived } from '../src/lib/ui/derived.ts'
import { doc } from '../src/lib/ui/doc.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { attr } from '../src/lib/ui/dom/attr.ts'
import { awaitBlock } from '../src/lib/ui/dom/awaitBlock.ts'
import { each } from '../src/lib/ui/dom/each.ts'
import { injectStyle } from '../src/lib/ui/dom/injectStyle.ts'
import { on } from '../src/lib/ui/dom/on.ts'
import { openChild } from '../src/lib/ui/dom/openChild.ts'
import { openRoot } from '../src/lib/ui/dom/openRoot.ts'
import { switchBlock } from '../src/lib/ui/dom/switchBlock.ts'
import { text } from '../src/lib/ui/dom/text.ts'
import { when } from '../src/lib/ui/dom/when.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})

describe('scopeCss', () => {
    test('appends the scope attribute to each selector key, before pseudos', () => {
        const out = scopeCss('h1 { color: red } .x a:hover { color: blue }', 'data-b-z')
        expect(out).toContain('h1[data-b-z] {')
        expect(out).toContain('.x a[data-b-z]:hover {') // attr before :hover, scopes the key element
    })

    test('leaves at-rule preludes but scopes their inner rules', () => {
        const out = scopeCss('@media (min-width: 1px) { p { margin: 0 } }', 'data-b-z')
        expect(out).toContain('@media (min-width: 1px) {')
        expect(out).toContain('p[data-b-z] {')
    })
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
    injectStyle,
}

const STYLED = `
    <script>let n = state(7)</script>
    <main>
        <h1>title</h1>
        <p class="muted">{n}</p>
    </main>
    <style>
        h1 { color: red }
        .muted { opacity: 0.5 }
    </style>
`

describe('scoped <style> — client', () => {
    test('elements get the scope attribute and the scoped CSS is injected', () => {
        const body = compileComponent(STYLED)
        expect(body).toContain('injectStyle(')

        const host = document.createElement('div')
        const names = Object.keys(RUNTIME)
        new Function('host', ...names, body)(
            host,
            ...names.map((n) => RUNTIME[n as keyof typeof RUNTIME]),
        )

        const main = host.childNodes[0] as unknown as { attributes: Map<string, string> }
        const scopeAttr = [...main.attributes.keys()].find((k) => k.startsWith('data-b-'))
        expect(scopeAttr).toBeDefined()

        const head = (
            globalThis as unknown as {
                document: { head: { childNodes: { textContent: string }[] } }
            }
        ).document.head
        const styleText = head.childNodes.map((node) => node.textContent).join('')
        expect(styleText).toContain('color: red')
        expect(styleText).toContain(`h1[${scopeAttr}]`)
    })
})

describe('scoped <style> — SSR', () => {
    test('SSR emits the scoped style and the scope attribute on elements', () => {
        const render = new Function('doc', 'state', 'derived', 'effect', compileSSR(STYLED))(
            doc,
            state,
            derived,
            effect,
        ) as { html: string }
        expect(render.html).toMatch(/<style>h1\[data-b-[a-z0-9]+\] \{ color: red \}/)
        expect(render.html).toMatch(/<main data-b-[a-z0-9]+="">/)
        expect(render.html).toContain('<p data-b-')
    })
})

/* A `<style>` quoted inside a template expression (e.g. a code sample) is the
   expression's text, not the component's scoped style: only the real top-level
   `<style>` is extracted, so the expression renders intact. */
const QUOTED_STYLE = `
    <main>
        <pre>{'<style>.danger { color: blue }</style>'}</pre>
    </main>
    <style>
        h1 { color: red }
    </style>
`

describe('a <style> inside an expression is text, not the component style', () => {
    test('SSR scopes only the real <style>; the quoted one renders as escaped text', () => {
        const render = new Function('doc', 'state', 'derived', 'effect', compileSSR(QUOTED_STYLE))(
            doc,
            state,
            derived,
            effect,
        ) as { html: string }
        // The real top-level <style> is the scoped CSS.
        expect(render.html).toMatch(/<style>h1\[data-b-[a-z0-9]+\] \{ color: red \}/)
        // The quoted .danger rule is never extracted/scoped as the component style.
        expect(render.html).not.toContain('.danger[data-b-')
        // The expression renders intact as escaped text in the <pre>.
        expect(render.html).toContain('&lt;style&gt;.danger { color: blue }&lt;/style&gt;')
    })
})
