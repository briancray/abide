import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileModule } from '../src/lib/ui/compile/compileModule.ts'
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
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})

/* Runs a compiled component body against a fresh host, returns the host. */
function render(source: string): HTMLElement {
    const body = compileComponent(source)
    const host = document.createElement('div')
    new Function(
        'host',
        'doc',
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
        body,
    )(host, doc, text, openChild, openRoot, appendText, appendStatic, attr, on, each, when, effect)
    return host
}

describe('compileComponent — end to end', () => {
    test('renders interpolated text from the document', () => {
        const host = render(`
            <script>
                const model = doc({ name: 'ada' })
            </script>
            <p>Hello {model.name}</p>
        `)
        expect(host.textContent).toContain('Hello ada')
    })

    test('html comments are dropped, leaving no node in the output', () => {
        const host = render(`
            <!-- leading comment -->
            <p>visible<!-- inline --> text</p>
            <!-- trailing comment -->
        `)
        expect(host.textContent).toContain('visible')
        expect(host.textContent).toContain('text')
        expect(host.textContent).not.toContain('comment')
        expect(host.textContent).not.toContain('inline')
    })

    test('a counter button updates reactively through the lowered patch', () => {
        const host = render(`
            <script>
                const model = doc({ count: 0 })
                function increment() { model.count += 1 }
            </script>
            <button onclick={increment}>+</button>
            <p>Count: {model.count}</p>
        `)
        expect(host.textContent).toContain('Count: 0')
        const button = Array.from(host.childNodes).find(
            (node) => (node as { tagName?: string }).tagName === 'button',
        ) as unknown as { dispatchEvent: (event: { type: string }) => void }
        button.dispatchEvent({ type: 'click' })
        button.dispatchEvent({ type: 'click' })
        expect(host.textContent).toContain('Count: 2')
    })

    test('compiled output uses hoisted cells for the template read', () => {
        const body = compileComponent(`
            <script>const model = doc({ count: 0 })</script>
            <p>{model.count}</p>
        `)
        expect(body).toContain('model.cell("count")')
        expect(body).toContain('.get()')
    })

    test('if control flow toggles a branch and stays field-reactive', () => {
        const model = doc({ show: true, label: 'hi' })
        const body = compileComponent(`
            <div>
                <template if={model.show}>
                    <span>{model.label}</span>
                </template>
            </div>
        `)
        const host = document.createElement('div')
        new Function(
            'host',
            'doc',
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
            'model',
            body,
        )(
            host,
            doc,
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
            model,
        )
        const div = host.childNodes[0] as unknown as { textContent: string }
        expect(div.textContent).toBe('hi')
        model.replace('label', 'yo') // field-reactive while shown
        expect(div.textContent).toBe('yo')
        model.replace('show', false) // falsy edge → branch removed
        expect(div.textContent).toBe('')
        model.replace('show', true) // truthy edge → branch re-rendered
        expect(div.textContent).toBe('yo')
    })

    test('compileModule emits a mountable ES module with abide/ui imports', () => {
        const module = compileModule(`
            <script>const model = doc({ count: 0 })</script>
            <p>{model.count}</p>
        `)
        expect(module).toContain("import { mount } from '@abide/abide/ui/dom/mount'")
        expect(module).toContain("import { doc } from '@abide/abide/ui/doc'")
        expect(module).toContain('export default function component(host, $props)')
        expect(module).toContain('mount(host, (host) =>')
        expect(module).toContain('model.cell("count")')
    })

    test('keyed each renders a list and stays field-reactive', () => {
        const model = doc({ order: ['a', 'b'], byId: { a: { n: 1 }, b: { n: 2 } } })
        const body = compileComponent(`
            <ul>
                <template each={model.order} as="key" key="key">
                    <li>{model.byId[key].n}</li>
                </template>
            </ul>
        `)
        const host = document.createElement('div')
        new Function(
            'host',
            'doc',
            'text',
            'openChild',
            'openRoot',
            'appendText',
            'appendStatic',
            'attr',
            'on',
            'each',
            'effect',
            'model',
            body,
        )(
            host,
            doc,
            text,
            openChild,
            openRoot,
            appendText,
            appendStatic,
            attr,
            on,
            each,
            effect,
            model,
        )
        const list = host.childNodes[0] as unknown as { children: Element[] }
        expect(list.children.map((child) => child.textContent)).toEqual(['1', '2'])
        model.replace('byId/a/n', 9)
        expect(list.children[0].textContent).toBe('9')
        model.add('order/-', 'c')
        model.replace('byId/c', { n: 3 })
        expect(list.children.map((child) => child.textContent)).toEqual(['9', '2', '3'])
    })
})
