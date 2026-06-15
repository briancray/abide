import { beforeAll, describe, expect, test } from 'bun:test'
import { doc } from '../src/lib/ui/doc.ts'
import { attr } from '../src/lib/ui/dom/attr.ts'
import { each } from '../src/lib/ui/dom/each.ts'
import { mount } from '../src/lib/ui/dom/mount.ts'
import { on } from '../src/lib/ui/dom/on.ts'
import { text } from '../src/lib/ui/dom/text.ts'
import { installMiniDom } from './support/installMiniDom.ts'

/* The dom bindings read a global `document`; the mini-DOM provides one headless. */
beforeAll(() => {
    installMiniDom()
})

function host(): HTMLElement {
    return document.createElement('div')
}

describe('text binding', () => {
    test('renders and updates on doc change', () => {
        const model = doc({ count: 0 })
        const root = host()
        mount(root, (h) => h.appendChild(text(() => model.read('count'))))
        expect(root.textContent).toBe('0')
        model.replace('count', 5)
        expect(root.textContent).toBe('5')
    })

    test('dispose stops updates and clears the host', () => {
        const model = doc({ count: 0 })
        const root = host()
        const dispose = mount(root, (h) => h.appendChild(text(() => model.read('count'))))
        dispose()
        expect(root.textContent).toBe('')
        model.replace('count', 9) // no live binding → no throw, nothing to update
        expect(root.textContent).toBe('')
    })
})

describe('attr and on bindings', () => {
    test('attribute tracks the doc; boolean false removes it', () => {
        const model = doc({ disabled: true })
        const root = host()
        const button = document.createElement('button')
        mount(root, (h) => {
            attr(button, 'disabled', () => model.read('disabled'))
            h.appendChild(button)
        })
        expect(button.hasAttribute('disabled')).toBe(true)
        model.replace('disabled', false)
        expect(button.hasAttribute('disabled')).toBe(false)
    })

    test('a click handler runs a lowered patch', () => {
        const model = doc({ count: 0 })
        const root = host()
        const button = document.createElement('button')
        mount(root, (h) => {
            on(button, 'click', () => model.replace('count', model.read<number>('count') + 1))
            h.appendChild(text(() => model.read('count')))
            h.appendChild(button)
        })
        button.dispatchEvent(new (globalThis as { Event: typeof Event }).Event('click'))
        button.dispatchEvent(new (globalThis as { Event: typeof Event }).Event('click'))
        expect(root.textContent).toContain('2')
    })
})

describe('keyed each', () => {
    test('keyed store: rows survive add/remove and stay field-reactive', () => {
        /* Entities are addressed by key (byId), order drives the sequence — the
           normalised, key-addressed shape, so a row binds to a stable path and
           survives removal of an earlier row without rebinding. */
        const model = doc({
            order: ['a', 'b'],
            byId: { a: { n: 1 }, b: { n: 2 }, c: { n: 3 } },
        })
        const root = host()
        const list = document.createElement('ul')
        mount(root, (h) => {
            each(
                list,
                () => model.read<string[]>('order'),
                (key) => key,
                (key) => {
                    const li = document.createElement('li')
                    li.appendChild(text(() => model.read(`byId/${key}/n`)))
                    return li
                },
            )
            h.appendChild(list)
        })
        expect([...list.children].map((c) => c.textContent)).toEqual(['1', '2'])

        model.add('order/-', 'c') // structural → each reconciles
        expect([...list.children].map((c) => c.textContent)).toEqual(['1', '2', '3'])

        model.replace('byId/a/n', 9) // deep field → only row 'a' updates, no reconcile
        expect(list.children[0].textContent).toBe('9')

        model.remove('order/0') // drop 'a'; 'b' and 'c' keep their stable bindings
        expect([...list.children].map((c) => c.textContent)).toEqual(['2', '3'])

        model.replace('byId/c/n', 30) // 'c' still field-reactive after the removal
        expect(list.children[1].textContent).toBe('30')
    })

    test('reorder keeps row nodes (keyed identity)', () => {
        const model = doc({ items: [{ id: 'a' }, { id: 'b' }] })
        const root = host()
        const list = document.createElement('ul')
        const nodes: Record<string, Element> = {}
        mount(root, (h) => {
            each(
                list,
                () => model.read<{ id: string }[]>('items'),
                (item) => item.id,
                (item) => {
                    const li = document.createElement('li')
                    li.setAttribute('data-id', item.id)
                    nodes[item.id] = li
                    return li
                },
            )
            h.appendChild(list)
        })
        const aNode = nodes.a
        model.replace('items', [{ id: 'b' }, { id: 'a' }])
        expect([...list.children].map((c) => c.getAttribute('data-id'))).toEqual(['b', 'a'])
        expect(list.children[1]).toBe(aNode) // same node moved, not recreated
    })
})
