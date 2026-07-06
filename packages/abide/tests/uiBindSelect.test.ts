import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import { escapeKey } from '../src/lib/ui/runtime/escapeKey.ts'
import { state } from '../src/lib/ui/state.ts'
import { installHappyDom } from './support/installHappyDom.ts'

let reset: () => void
beforeAll(() => {
    reset = installHappyDom()
})
afterAll(() => reset())

/* Runs a compiled SSR body to its HTML string (mini-dom-free; string builder only). */
function renderSSR(source: string): string {
    const result = new Function('doc', 'state', 'computed', 'escapeKey', compileSSR(source))(
        doc,
        state,
        computed,
        escapeKey,
    ) as { html: string }
    return result.html
}

/* Mounts a compiled client body into a fresh happy-dom host, returning the host and the
   component's own reactive document. Runtime helpers resolve to the `$$`-prefixed globals
   the test preload publishes from the real modules. */
function mountClient(source: string): {
    host: HTMLElement
    model: ReturnType<typeof doc>
} {
    const host = document.createElement('div')
    const model = new Function(
        'host',
        '$props',
        'doc',
        'state',
        'computed',
        'escapeKey',
        `${compileComponent(source)}\nreturn typeof $$model !== 'undefined' ? $$model : undefined;`,
    )(host, undefined, doc, state, computed, escapeKey) as ReturnType<typeof doc>
    return { host, model }
}

/* Let queued microtasks (the MutationObserver re-apply) drain. */
const flush = async (): Promise<void> => {
    for (let index = 0; index < 6; index += 1) {
        await Promise.resolve()
    }
}

const fireEvent = (element: EventTarget, type: string): void => {
    element.dispatchEvent(new (globalThis as { Event: typeof Event }).Event(type))
}

const SINGLE_FOR = `
    <script>import { state } from '@abide/abide/ui/state'
let choice = state('b')</script>
    <select bind:value={choice}>{#for o of ['a', 'b', 'c'] by o}<option value={o}>{o}</option>{/for}</select>
`

const MULTIPLE = `
    <script>import { state } from '@abide/abide/ui/state'
let picks = state(['a', 'c'])</script>
    <select multiple bind:value={picks}>
        <option value="a">A</option><option value="b">B</option><option value="c">C</option>
    </select>
`

describe('<select bind:value> SSR selects the matching option', () => {
    test('single: `selected` on the bound option among {#for}-generated options', () => {
        const html = renderSSR(SINGLE_FOR)
        expect(html).toContain('<option value="b" selected>b</option>')
        expect(html).toContain('<option value="a">a</option>')
        // the select itself never emits a (browser-ignored) value="…" attribute
        expect(html).not.toContain('<select value')
    })

    test('single: static-text option (no value attr) falls back to its text', () => {
        const html = renderSSR(`
            <script>import { state } from '@abide/abide/ui/state'
let choice = state('b')</script>
            <select bind:value={choice}><option>a</option><option>b</option></select>
        `)
        expect(html).toContain('<option selected>b</option>')
        expect(html).toContain('<option>a</option>')
    })

    test('multiple: `selected` on every member of the bound array', () => {
        const html = renderSSR(MULTIPLE)
        expect(html).toContain('<option value="a" selected>A</option>')
        expect(html).toContain('<option value="b">B</option>')
        expect(html).toContain('<option value="c" selected>C</option>')
    })
})

describe('<select bind:value> client', () => {
    test('single: initial value applies even though {#for} options mount after the bind', async () => {
        const { host } = mountClient(SINGLE_FOR)
        await flush()
        const select = host.querySelector('select') as HTMLSelectElement
        expect(select.value).toBe('b')
    })

    test('single: a user pick writes back to the bound state', async () => {
        const { host, model } = mountClient(SINGLE_FOR)
        await flush()
        const select = host.querySelector('select') as HTMLSelectElement
        select.value = 'c'
        fireEvent(select, 'change')
        expect(model.read<string>('choice')).toBe('c')
    })

    test('multiple: initial selection mirrors the bound array, and picks write back', async () => {
        const { host, model } = mountClient(MULTIPLE)
        await flush()
        const select = host.querySelector('select') as HTMLSelectElement
        const [a, b, c] = Array.from(select.options)
        expect(a.selected).toBe(true)
        expect(b.selected).toBe(false)
        expect(c.selected).toBe(true)

        // deselect c, add b → collected back into the array
        c.selected = false
        b.selected = true
        fireEvent(select, 'change')
        expect(model.read<string[]>('picks')).toEqual(['a', 'b'])
    })
})

describe('numeric input bind:value coerces to a number', () => {
    test('type="number" write-back is a number, empty is undefined', async () => {
        const { host, model } = mountClient(`
            <script>import { state } from '@abide/abide/ui/state'
let qty = state(0)</script>
            <input type="number" bind:value={qty}>
        `)
        await flush()
        const input = host.querySelector('input') as HTMLInputElement
        input.value = '42'
        fireEvent(input, 'input')
        expect(model.read<number>('qty')).toBe(42)
        expect(typeof model.read('qty')).toBe('number')

        input.value = ''
        fireEvent(input, 'input')
        expect(model.read('qty')).toBeUndefined()
    })
})

describe('<details bind:open> SSR is a boolean attribute', () => {
    test('open when truthy, absent when falsy (not open="false")', () => {
        const openHtml = renderSSR(`
            <script>import { state } from '@abide/abide/ui/state'
let isOpen = state(true)</script>
            <details bind:open={isOpen}><summary>x</summary></details>
        `)
        expect(openHtml).toContain('<details open>')

        const closedHtml = renderSSR(`
            <script>import { state } from '@abide/abide/ui/state'
let isOpen = state(false)</script>
            <details bind:open={isOpen}><summary>x</summary></details>
        `)
        expect(closedHtml).toContain('<details>')
        expect(closedHtml).not.toContain('open')
    })
})
