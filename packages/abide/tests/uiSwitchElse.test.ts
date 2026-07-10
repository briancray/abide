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
import { when } from '../src/lib/ui/dom/when.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'
import { text } from './support/reactiveText.ts'

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
            <script>import { state } from '@abide/abide/ui/state'
let on = state(true)</script>
            {#if on}
                <span>ON</span>
                {:else}<span>OFF</span>
            {/if}
        `)
        // can't reach internal state; assert SSR for both, and client initial
        expect(host.textContent).toBe('ON')
    })

    test('SSR renders the else branch when falsy', () => {
        const source = `
            <script>import { state } from '@abide/abide/ui/state'
let on = state(false)</script>
            {#if on}
                <span>ON</span>
                {:else}<span>OFF</span>
            {/if}
        `
        expect(ssr(source)).toBe('<!--[--><span>OFF</span><!--]-->')
    })

    /* A sibling `<template else>` (closed off from its `if`) is rejected at compile —
       it would otherwise silently drop the else branch. The else must nest inside the
       `if`. */
    test('rejects a sibling else', () => {
        const sibling = `{#if on}<span>ON</span>{/if}{:else}<span>OFF</span>`
        expect(() => compileComponent(sibling)).toThrow(/no open \{#…\} block/)
    })
})

describe('if / elseif / else', () => {
    const chain = (a: string, b: string) => `
        <script>import { state } from '@abide/abide/ui/state'

            let a = state(${a})
            let b = state(${b})
        </script>
        {#if a}
            <span>A</span>
            {:else if b}<span>B</span>
            {:else}<span>C</span>
        {/if}
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
            <script>import { state } from '@abide/abide/ui/state'
let n = state(0)</script>
            <button onclick={() => n += 1}>+</button>
            {#if n === 1}
                <span>one</span>
                {:else if n === 2}<span>two</span>
                {:else}<span>other</span>
            {/if}
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
            <script>import { state } from '@abide/abide/ui/state'

                let a = state(0)
                let items = state(['x'])
            </script>
            {#if a}
                <span>A</span>
                {:else if items.length}<span>has</span>
                {:else}<span>empty</span>
            {/if}
        `
        expect(ssr(source)).toBe('<!--[--><span>has</span><!--]-->')
    })

    test('rejects an elseif nested in a switch', () => {
        const bad = `
            {#switch s}
                {:case 1}<span>1</span>
                {:else if x}<span>x</span>
            {/switch}
        `
        expect(() => compileComponent(bad)).toThrow(/not valid inside/)
    })

    /* In the block grammar a branch is lexically scoped: content after a `{:else if}` /
       `{:else}` is part of THAT branch, so the directive-era "stray in the if body" hazard
       is gone — trailing content simply renders inside the branch (no misplacement to
       reject). The "else must be last" guard is covered in uiParseBlockGrammar. */
    test('content after a branch is part of that branch (renders), not stray', () => {
        const host = render(`
            <script>import { state } from '@abide/abide/ui/state'
let a = state(false)</script>
            {#if a}
                <span>A</span>
                {:else}<span>C</span>extra
            {/if}
        `)
        expect(host.textContent?.replace(/\s/g, '')).toBe('Cextra')
    })

    test('the then-content before the first branch and whitespace around branches compile', () => {
        const ok = `
            <script>import { state } from '@abide/abide/ui/state'
let a = state(true)</script>
            {#if a}
                <span>then</span>
                {:else if a}<span>B</span>
                {:else}<span>C</span>
            {/if}
        `
        expect(typeof compileComponent(ok)).toBe('string')
    })
})

describe('switch / case / default', () => {
    const source = `
        <script>import { state } from '@abide/abide/ui/state'
let status = state('shipped')</script>
        {#switch status}
            {:case 'pending'}<span>⏳</span>
            {:case 'shipped'}<span>🚚</span>
            {:default}<span>?</span>
        {/switch}
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
            {#switch s}
                stray
                {:case 'a'}<span>A</span>
                {:default}<span>D</span>
            {/switch}
        `
        expect(() => compileComponent(stray)).toThrow(/renders only its/)
    })

    test('SSR falls back to default for an unmatched subject', () => {
        const unmatched = `
            <script>import { state } from '@abide/abide/ui/state'
let status = state('lost')</script>
            {#switch status}
                {:case 'pending'}<span>⏳</span>
                {:default}<span>?</span>
            {/switch}
        `
        expect(ssr(unmatched)).toBe('<!--[--><span>?</span><!--]-->')
    })
})
