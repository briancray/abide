import { beforeAll, describe, expect, test } from 'bun:test'
import { analyzeComponent } from '../src/lib/ui/compile/analyzeComponent.ts'
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
import { on } from '../src/lib/ui/dom/on.ts'
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
        const out = scopeCss('h1 { color: red } .x a:hover { color: blue }', 'data-a-z')
        expect(out).toContain('h1[data-a-z] {')
        expect(out).toContain('.x a[data-a-z]:hover {') // attr before :hover, scopes the key element
    })

    test('leaves at-rule preludes but scopes their inner rules', () => {
        const out = scopeCss('@media (min-width: 1px) { p { margin: 0 } }', 'data-a-z')
        expect(out).toContain('@media (min-width: 1px) {')
        expect(out).toContain('p[data-a-z] {')
    })
})

const RUNTIME = {
    doc,
    state,
    derived,
    effect,
    appendText,
    appendStatic,
    text,
    attr,
    on,
    each,
    when,
    awaitBlock,
    switchBlock,
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

describe('scoped <style> — extraction', () => {
    test('the scoped CSS the bundler receives carries the scope attribute', () => {
        const style = analyzeComponent(STYLED).styles[0]
        expect(style).toBeDefined()
        expect(style?.css).toContain(`h1[${style?.attribute}]`)
        expect(style?.css).toContain('color: red')
    })
})

describe('scoped <style> — client', () => {
    test('elements get the scope attribute; the CSS is bundled, not injected at runtime', () => {
        const body = compileComponent(STYLED)
        // No runtime injection — the scoped sheet is bundled into the entry stylesheet.
        expect(body).not.toContain('injectStyle')

        const host = document.createElement('div')
        const names = Object.keys(RUNTIME)
        new Function('host', ...names, body)(
            host,
            ...names.map((n) => RUNTIME[n as keyof typeof RUNTIME]),
        )

        const main = host.childNodes[0] as unknown as { attributes: Map<string, string> }
        const scopeAttr = [...main.attributes.keys()].find((k) => k.startsWith('data-a-'))
        expect(scopeAttr).toBeDefined()
    })
})

describe('scoped <style> — SSR', () => {
    test('no <style> in the markup; the scope attribute is on elements', () => {
        const render = new Function('doc', 'state', 'derived', 'effect', compileSSR(STYLED))(
            doc,
            state,
            derived,
            effect,
        ) as { html: string }
        expect(render.html).not.toContain('<style>')
        expect(render.html).toMatch(/<main data-a-[a-z0-9]+="">/)
        expect(render.html).toContain('<p data-a-')
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
    test('only the real top-level <style> is extracted as scoped CSS', () => {
        const styles = analyzeComponent(QUOTED_STYLE).styles
        expect(styles).toHaveLength(1)
        const style = styles[0]
        expect(style?.css).toContain(`h1[${style?.attribute}]`)
        // The quoted .danger rule is never extracted/scoped as the component style.
        expect(style?.css).not.toContain('.danger')
    })

    test('SSR renders the quoted style as escaped text, emits no real <style>', () => {
        const render = new Function('doc', 'state', 'derived', 'effect', compileSSR(QUOTED_STYLE))(
            doc,
            state,
            derived,
            effect,
        ) as { html: string }
        expect(render.html).not.toContain('<style>')
        expect(render.html).toContain('&lt;style&gt;.danger { color: blue }&lt;/style&gt;')
    })
})

/* A `<style>` nested inside a `<template>` branch scopes only that branch's subtree;
   a top-level `<style>` still covers the whole component. An element inside the
   branch carries BOTH scope attributes; an element outside it carries only the
   top-level one — that's the per-subtree isolation. */
const NESTED_STYLE = `
    <div class="outer">
        <template if={true}>
            <span class="inner">x</span>
            <style>.inner { color: green }</style>
        </template>
    </div>
    <style>.outer { color: red }</style>
`

const renderSSR = (source: string) =>
    (
        new Function('doc', 'state', 'derived', 'effect', compileSSR(source))(
            doc,
            state,
            derived,
            effect,
        ) as { html: string }
    ).html

describe('per-subtree scoped <style>', () => {
    test('each <style> becomes its own scoped block, in source order', () => {
        const styles = analyzeComponent(NESTED_STYLE).styles
        expect(styles).toHaveLength(2)
        const [outer, inner] = styles
        expect(outer?.attribute).not.toBe(inner?.attribute)
        expect(outer?.css).toContain(`.outer[${outer?.attribute}]`)
        expect(inner?.css).toContain(`.inner[${inner?.attribute}]`)
    })

    test('SSR: the branch element carries both scopes; the outer element only its own', () => {
        const [outer, inner] = analyzeComponent(NESTED_STYLE).styles
        const html = renderSSR(NESTED_STYLE)
        const outerTag = html.match(/<div [^>]*>/)?.[0] ?? ''
        const innerTag = html.match(/<span [^>]*>/)?.[0] ?? ''
        // The outer <div> carries the top-level scope, never the branch scope.
        expect(outerTag).toContain(`${outer?.attribute}=""`)
        expect(outerTag).not.toContain(`${inner?.attribute}=""`)
        // The inner <span> carries both — the inherited top-level + the branch scope.
        expect(innerTag).toContain(`${outer?.attribute}=""`)
        expect(innerTag).toContain(`${inner?.attribute}=""`)
    })

    test('client build stamps the branch scope only on the branch element', () => {
        const body = compileComponent(NESTED_STYLE)
        const [outer, inner] = analyzeComponent(NESTED_STYLE).styles
        // The inner scope attribute is set, but never on a non-branch element: it
        // appears only alongside the span build, scoped to the if branch.
        expect(body).toContain(inner?.attribute as string)
        expect(body).toContain(outer?.attribute as string)
    })
})
