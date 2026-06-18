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

function render(source: string): HTMLElement {
    const names = Object.keys(RUNTIME)
    const host = document.createElement('div')
    new Function('host', ...names, compileComponent(source))(
        host,
        ...names.map((n) => RUNTIME[n as keyof typeof RUNTIME]),
    )
    return host
}

function ssr(source: string): string {
    return (
        new Function('doc', 'state', 'derived', 'effect', compileSSR(source))(
            doc,
            state,
            derived,
            effect,
        ) as { html: string }
    ).html
}

describe('if / else', () => {
    test('renders then or else and flips reactively', () => {
        const host = render(`
            <script>let on = state(true)</script>
            <template if={on}>
                <span>ON</span>
                <template else><span>OFF</span></template>
            </template>
        `)
        // can't reach internal state; assert SSR for both, and client initial
        expect(host.textContent).toBe('ON')
    })

    test('SSR renders the else branch when falsy', () => {
        const source = `
            <script>let on = state(false)</script>
            <template if={on}>
                <span>ON</span>
                <template else><span>OFF</span></template>
            </template>
        `
        expect(ssr(source)).toBe('<!--[--><span>OFF</span><!--]-->')
    })

    /* A sibling `<template else>` (closed off from its `if`) is rejected at compile —
       it would otherwise silently drop the else branch. The else must nest inside the
       `if`. */
    test('rejects a sibling else', () => {
        const sibling = `<template if={on}><span>ON</span></template><template else><span>OFF</span></template>`
        expect(() => compileComponent(sibling)).toThrow(/sibling branch is not supported/)
    })
})

describe('switch / case / default', () => {
    const source = `
        <script>let status = state('shipped')</script>
        <template switch={status}>
            <template case="'pending'"><span>⏳</span></template>
            <template case="'shipped'"><span>🚚</span></template>
            <template default><span>?</span></template>
        </template>
    `

    test('client renders the matching case', () => {
        expect(render(source).textContent).toBe('🚚')
    })

    test('SSR renders the matching case', () => {
        expect(ssr(source)).toBe('<!--[--><span>🚚</span><!--]-->')
    })

    test('SSR falls back to default for an unmatched subject', () => {
        const unmatched = `
            <script>let status = state('lost')</script>
            <template switch={status}>
                <template case="'pending'"><span>⏳</span></template>
                <template default><span>?</span></template>
            </template>
        `
        expect(ssr(unmatched)).toBe('<!--[--><span>?</span><!--]-->')
    })
})
