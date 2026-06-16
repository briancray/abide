import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { derived } from '../src/lib/ui/derived.ts'
import { doc } from '../src/lib/ui/doc.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { attr } from '../src/lib/ui/dom/attr.ts'
import { each } from '../src/lib/ui/dom/each.ts'
import { on } from '../src/lib/ui/dom/on.ts'
import { openChild } from '../src/lib/ui/dom/openChild.ts'
import { openRoot } from '../src/lib/ui/dom/openRoot.ts'
import { text } from '../src/lib/ui/dom/text.ts'
import { when } from '../src/lib/ui/dom/when.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})

/* Runs a compiled SSR body to its HTML string. */
function renderSSR(source: string): string {
    const result = new Function('doc', 'state', 'derived', 'effect', compileSSR(source))(
        doc,
        state,
        derived,
        effect,
    ) as { html: string }
    return result.html
}

/* Mounts a compiled client body into a fresh mini-DOM host, returning the host and
   the component's own reactive document (the body declares `model` from `state`). */
function mountClient(source: string): { host: HTMLElement; model: ReturnType<typeof doc> } {
    const host = document.createElement('div')
    const model = new Function(
        'host',
        'doc',
        'state',
        'derived',
        'text',
        'openChild',
        'openRoot',
        'appendText',
        'appendStatic',
        'attr',
        'on',
        'each',
        'when',
        'effect',
        `${compileComponent(source)}\nreturn typeof model !== 'undefined' ? model : undefined;`,
    )(
        host,
        doc,
        state,
        derived,
        text,
        openChild,
        openRoot,
        appendText,
        appendStatic,
        attr,
        on,
        each,
        when,
        effect,
    ) as ReturnType<typeof doc>
    return { host, model }
}

const CHECKBOXES = `
    <script>let toppings = state(['cheese', 'olive'])</script>
    <template each={['cheese', 'mushroom', 'olive']} as="t" key="t">
        <input type="checkbox" value={t} bind:group={toppings}>
    </template>
`

const RADIOS = `
    <script>let size = state('medium')</script>
    <template each={['small', 'medium', 'large']} as="s" key="s">
        <input type="radio" value={s} bind:group={size}>
    </template>
`

/* The mini-DOM has no querySelectorAll; gather input elements by walking. */
function inputs(node: HTMLElement): HTMLInputElement[] {
    const found: HTMLInputElement[] = []
    for (const child of (node as unknown as { childNodes: HTMLElement[] }).childNodes ?? []) {
        if ((child as unknown as { tagName?: string }).tagName === 'input') {
            found.push(child as unknown as HTMLInputElement)
        }
        found.push(...inputs(child))
    }
    return found
}

describe('bind:group SSR', () => {
    test('checkbox: checked attribute present only for members of the array', () => {
        // cheese + olive are in the array, mushroom is not
        expect(renderSSR(CHECKBOXES)).toBe(
            '<input type="checkbox" value="cheese" checked>' +
                '<input type="checkbox" value="mushroom">' +
                '<input type="checkbox" value="olive" checked>',
        )
    })

    test('radio: checked attribute present only on the selected value', () => {
        expect(renderSSR(RADIOS)).toBe(
            '<input type="radio" value="small">' +
                '<input type="radio" value="medium" checked>' +
                '<input type="radio" value="large">',
        )
    })

    test('bind:checked renders as a boolean attribute, absent when false', () => {
        const html = renderSSR(`
            <script>let on = state(false)</script>
            <input type="checkbox" bind:checked={on}>
        `)
        expect(html).toBe('<input type="checkbox">')
    })
})

describe('bind:group client', () => {
    test('checkbox toggle adds and removes the value from the array', () => {
        const { host, model } = mountClient(CHECKBOXES) // initial: ['cheese', 'olive']
        const [cheese, mushroom] = inputs(host)

        // initial checked state mirrors membership
        expect(cheese.checked).toBe(true)
        expect(mushroom.checked).toBe(false)

        // check mushroom → appended to the array
        mushroom.checked = true
        mushroom.dispatchEvent(new (globalThis as { Event: typeof Event }).Event('change'))
        expect(model.read<string[]>('toppings')).toEqual(['cheese', 'olive', 'mushroom'])

        // uncheck cheese → removed (the array reindexes via splice)
        cheese.checked = false
        cheese.dispatchEvent(new (globalThis as { Event: typeof Event }).Event('change'))
        expect(model.read<string[]>('toppings')).toEqual(['olive', 'mushroom'])
    })

    test('radio change replaces the single bound value', () => {
        const { host, model } = mountClient(RADIOS) // initial: 'medium'
        const [small, medium, large] = inputs(host)

        expect(medium.checked).toBe(true)
        expect(small.checked).toBe(false)

        large.checked = true
        large.dispatchEvent(new (globalThis as { Event: typeof Event }).Event('change'))
        expect(model.read<string>('size')).toBe('large')
    })
})
