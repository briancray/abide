import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { derived } from '../src/lib/ui/derived.ts'
import { doc } from '../src/lib/ui/doc.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { attr } from '../src/lib/ui/dom/attr.ts'
import { each } from '../src/lib/ui/dom/each.ts'
import { on } from '../src/lib/ui/dom/on.ts'
import { text } from '../src/lib/ui/dom/text.ts'
import { when } from '../src/lib/ui/dom/when.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})

/* Finds the first descendant element with the given tag (depth-first). */
function findTag(node: unknown, tag: string): unknown {
    const parent = node as { childNodes?: Iterable<unknown> }
    for (const child of parent.childNodes ?? []) {
        const element = child as { tagName?: string }
        if (element.tagName === tag) {
            return element
        }
        const found = findTag(child, tag)
        if (found !== undefined) {
            return found
        }
    }
    return undefined
}

/*
Compiles the kitchen-sink .abide fixture and runs it against the mini-DOM — a
full single-file component exercising text interpolation, an event handler, a
two-way `bind:value`, an `if` block, and a keyed `each`, all driven by the
document. End-to-end proof the framework renders and reacts as a whole.
*/
describe('kitchen-sink .abide component', () => {
    test('renders, binds input, toggles if, and appends list items', async () => {
        const source = await Bun.file(
            new URL('./support/kitchenSink.abide', import.meta.url).pathname,
        ).text()
        const body = compileComponent(source)
        const host = document.createElement('div')
        new Function(
            'host',
            'doc',
            'state',
            'derived',
            'text',
            'appendText',
            'appendStatic',
            'attr',
            'on',
            'each',
            'when',
            'effect',
            body,
        )(host, doc, state, derived, text, appendText, appendStatic, attr, on, each, when, effect)

        const list = findTag(host, 'ul') as { children: { textContent: string }[] }
        const input = findTag(host, 'input') as {
            value: string
            dispatchEvent: (event: { type: string }) => void
        }
        const button = findTag(host, 'button') as {
            dispatchEvent: (event: { type: string }) => void
        }

        // initial render from the document
        expect(list.children.map((child) => child.textContent)).toEqual(['first'])
        expect(host.textContent).toContain('Draft: ')
        expect(host.textContent).toContain('Count: 1') // derived(() => order.length)
        expect(host.textContent).not.toContain('typing…')

        // type into the input → bind writes the draft → <p> + if-block react
        input.value = 'second'
        input.dispatchEvent({ type: 'input' })
        expect(host.textContent).toContain('Draft: second')
        expect(host.textContent).toContain('typing…')

        // click Add → new keyed row, draft cleared, if-block hidden, derived recomputed
        button.dispatchEvent({ type: 'click' })
        expect(list.children.map((child) => child.textContent)).toEqual(['first', 'second'])
        expect(host.textContent).toContain('Draft: ')
        expect(host.textContent).toContain('Count: 2') // derived tracked the push
        expect(host.textContent).not.toContain('typing…')

        // the cleared draft also flowed back to the input (two-way)
        expect(input.value).toBe('')
    })
})
