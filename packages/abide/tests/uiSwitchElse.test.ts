import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { computed } from '../src/lib/ui/computed.ts'
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
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
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
        new Function('doc', 'state', 'computed', 'effect', compileSSR(source))(
            doc,
            state,
            computed,
            effect,
        ) as { html: string }
    ).html
}

describe('if / else', () => {
    test('renders then or else and flips reactively', () => {
        const host = render(`
            <script>let on = scope().state(true)</script>
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
            <script>let on = scope().state(false)</script>
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

describe('if / elseif / else', () => {
    const chain = (a: string, b: string) => `
        <script>
            let a = scope().state(${a})
            let b = scope().state(${b})
        </script>
        <template if={a}>
            <span>A</span>
            <template elseif={b}><span>B</span></template>
            <template else><span>C</span></template>
        </template>
    `

    test('SSR picks the matching elseif branch', () => {
        expect(ssr(chain('false', 'true'))).toBe('<!--[--><span>B</span><!--]-->')
    })

    test('SSR falls through to else when no condition holds', () => {
        expect(ssr(chain('false', 'false'))).toBe('<!--[--><span>C</span><!--]-->')
    })

    test('SSR: the if wins over a later truthy elseif', () => {
        expect(ssr(chain('true', 'true'))).toBe('<!--[--><span>A</span><!--]-->')
    })

    test('client renders the matching elseif branch', () => {
        expect(render(chain('false', 'true')).textContent).toBe('B')
    })

    test('client flips across if / elseif / else reactively', () => {
        const host = render(`
            <script>let n = scope().state(0)</script>
            <button onclick={() => n += 1}>+</button>
            <template if={n === 1}>
                <span>one</span>
                <template elseif={n === 2}><span>two</span></template>
                <template else><span>other</span></template>
            </template>
        `)
        const button = Array.from(host.childNodes).find(
            (node) => (node as { tagName?: string }).tagName === 'button',
        ) as unknown as { dispatchEvent: (event: { type: string }) => void }
        expect(host.textContent).toBe('+other') // n=0 → else
        button.dispatchEvent({ type: 'click' })
        expect(host.textContent).toBe('+one') // n=1 → if
        button.dispatchEvent({ type: 'click' })
        expect(host.textContent).toBe('+two') // n=2 → elseif
        button.dispatchEvent({ type: 'click' })
        expect(host.textContent).toBe('+other') // n=3 → else
    })

    test('a non-boolean elseif condition coerces truthily', () => {
        const source = `
            <script>
                let a = scope().state(0)
                let items = scope().state(['x'])
            </script>
            <template if={a}>
                <span>A</span>
                <template elseif={items.length}><span>has</span></template>
                <template else><span>empty</span></template>
            </template>
        `
        expect(ssr(source)).toBe('<!--[--><span>has</span><!--]-->')
    })

    test('rejects an elseif nested in a switch', () => {
        const bad = `
            <template switch={s}>
                <template case="1"><span>1</span></template>
                <template elseif={x}><span>x</span></template>
            </template>
        `
        expect(() => compileComponent(bad)).toThrow(/elseif/)
    })

    /* Loose content sitting AFTER a branch tag belongs to no branch — it would silently
       fold into the `then`. Reject it; whitespace and the leading then-content stay legal. */
    test('rejects rendered content after a branch in an if-chain', () => {
        const stray = `
            <template if={a}>
                <span>A</span>
                <template elseif={b}><span>B</span></template>stray
                <template else><span>C</span></template>
            </template>
        `
        expect(() => compileComponent(stray)).toThrow(/belongs to no branch/)
    })

    test('rejects a rendered element after a branch in an if-chain', () => {
        const stray = `
            <template if={a}>
                <span>A</span>
                <template else><span>C</span></template>
                <span>orphan</span>
            </template>
        `
        expect(() => compileComponent(stray)).toThrow(/belongs to no branch/)
    })

    test('the then-content before the first branch and whitespace around branches compile', () => {
        const ok = `
            <script>let a = scope().state(true)</script>
            <template if={a}>
                <span>then</span>
                <template elseif={a}><span>B</span></template>
                <template else><span>C</span></template>
            </template>
        `
        expect(typeof compileComponent(ok)).toBe('string')
    })
})

describe('switch / case / default', () => {
    const source = `
        <script>let status = scope().state('shipped')</script>
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

    /* A `switch` renders only its case/default branches — loose content anywhere in its
       body (it would be silently dropped) is rejected. */
    test('rejects rendered content in a switch body', () => {
        const stray = `
            <template switch={s}>
                stray
                <template case="'a'"><span>A</span></template>
                <template default><span>D</span></template>
            </template>
        `
        expect(() => compileComponent(stray)).toThrow(/renders only its/)
    })

    test('SSR falls back to default for an unmatched subject', () => {
        const unmatched = `
            <script>let status = scope().state('lost')</script>
            <template switch={status}>
                <template case="'pending'"><span>⏳</span></template>
                <template default><span>?</span></template>
            </template>
        `
        expect(ssr(unmatched)).toBe('<!--[--><span>?</span><!--]-->')
    })
})
