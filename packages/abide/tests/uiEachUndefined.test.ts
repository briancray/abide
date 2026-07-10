import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { attr } from '../src/lib/ui/dom/attr.ts'
import { each } from '../src/lib/ui/dom/each.ts'
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
    text,
    appendText,
    appendStatic,
    attr,
    each,
}

/* Mount a component, threading extra runtime values (a shared `state`) in by name. */
function render(source: string, extra: Record<string, unknown> = {}): HTMLElement {
    const names = [...Object.keys(RUNTIME), ...Object.keys(extra)]
    const host = document.createElement('div')
    const args = names.map((name) => extra[name] ?? RUNTIME[name as keyof typeof RUNTIME])
    new Function('host', ...names, compileComponent(source))(host, ...args)
    return host
}

/* Run the component's (synchronous) SSR render to its HTML string. */
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

/* ADR-0032 D3: a `{#for x in v}` over an undefined source renders an empty list, never
   a throw — a lifted async source peeks undefined while pending. */
describe('undefined coercion — {#for} over an undefined source', () => {
    test('client renders an empty list, no throw', () => {
        const items = state<string[] | undefined>(undefined)
        const host = render(`<script></script><ul>{#for x of items.value}<li>{x}</li>{/for}</ul>`, {
            items,
        })
        expect(host.textContent).toBe('')
    })

    test('client resolves to rows once the source becomes an array', () => {
        const items = state<string[] | undefined>(undefined)
        const host = render(`<script></script><ul>{#for x of items.value}<li>{x}</li>{/for}</ul>`, {
            items,
        })
        expect(host.textContent).toBe('')
        items.value = ['a', 'b']
        expect(host.textContent).toBe('ab')
    })

    test('SSR renders no rows, no throw', () => {
        const source = `<script>import { state } from '@abide/abide/ui/state'
let list = state(undefined)</script><ul>{#for x of list.value}<li>{x}</li>{/for}</ul>`
        const html = ssr(source)
        expect(html).not.toContain('<li')
        expect(html).toContain('<ul>')
    })
})
