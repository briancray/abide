import { beforeAll, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { attr } from '../src/lib/ui/dom/attr.ts'
import { each } from '../src/lib/ui/dom/each.ts'
import { text } from '../src/lib/ui/dom/text.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})

function run(source: string, extra: Record<string, unknown> = {}): HTMLElement {
    const names = [
        'host',
        'doc',
        'state',
        'computed',
        'text',
        'appendText',
        'appendStatic',
        'attr',
        'each',
        'effect',
    ]
    const runtime: Record<string, unknown> = {
        doc,
        state,
        computed,
        text,
        appendText,
        appendStatic,
        attr,
        each,
        effect,
    }
    const host = document.createElement('div')
    const allNames = [...names, ...Object.keys(extra)]
    const args = allNames.map((name) => (name === 'host' ? host : (extra[name] ?? runtime[name])))
    new Function(...allNames, compileComponent(source))(...args)
    return host
}

/* First descendant element with the given tag name (miniDom has no querySelector). */
type DomLike = { childNodes: ArrayLike<unknown>; tagName?: string; textContent?: string | null }
function find(node: DomLike, tag: string): DomLike | undefined {
    for (let index = 0; index < node.childNodes.length; index += 1) {
        const child = node.childNodes[index] as DomLike
        if (child.tagName === tag.toUpperCase() || child.tagName === tag) {
            return child
        }
        const nested = find(child, tag)
        if (nested !== undefined) {
            return nested
        }
    }
    return undefined
}

test('keyed each updates a changed item in place — same key, new object, same row DOM', () => {
    // The grid replaces a changed root with a NEW object under the SAME key (foldMediaGridDelta).
    // The keyed each must repaint that row's content WITHOUT rebuilding it: the row's <span> keeps
    // identity (no flash), and its text reflects the new value. Unchanged rows stay untouched.
    const items = state([
        { id: 1, label: 'a' },
        { id: 2, label: 'b' },
    ])
    const host = run(
        `
        <script></script>
        <template each={items.value} as="item" key="item.id"><span>{item.label}</span></template>
    `,
        { items },
    )
    expect(host.textContent).toBe('ab')
    const firstSpan = find(host, 'span') // row 1's span before the change
    items.value = [
        { id: 1, label: 'A!' }, // same key, new object, new label
        { id: 2, label: 'b' },
    ]
    expect(host.textContent).toBe('A!b') // changed row repainted
    expect(find(host, 'span')).toBe(firstSpan) // built once, updated in place
})

test('keyless destructured `as` renders and keys rows by item identity', () => {
    // A destructuring `as` with no explicit `key` must default the key to the row's RAW item
    // (by identity), NOT the destructure pattern re-wrapped — `[label, n]` re-emitted as a key
    // would allocate a fresh array per reconcile, so every row would rebuild on any change.
    const first = ['x', 1]
    const second = ['y', 2]
    const items = state([first, second])
    const host = run(
        `
        <script></script>
        <template each={items.value} as="[label, n]"><span>{label}:{n}</span></template>
    `,
        { items },
    )
    expect(host.textContent).toBe('x:1y:2')
    const firstSpan = find(host, 'span') // row `first`'s span before the change
    // Append a row; the existing tuples keep their references, so they key by identity and
    // their rows are reused (not rebuilt) — only the new row is built.
    items.value = [first, second, ['z', 3]]
    expect(host.textContent).toBe('x:1y:2z:3')
    expect(find(host, 'span')).toBe(firstSpan) // row `first` reused, not rebuilt
})

test('index="i" binds each row position', () => {
    const items = state([
        { id: 1, label: 'a' },
        { id: 2, label: 'b' },
        { id: 3, label: 'c' },
    ])
    const host = run(
        `
        <script></script>
        <template each={items.value} as="item" key="item.id" index="i"><span>{i}:{item.label}</span></template>
    `,
        { items },
    )
    expect(host.textContent).toBe('0:a1:b2:c')
})

test('reactive index repaints a reordered row in place — same key, new position', () => {
    // Keyed rows keep identity across a reorder. The index rides a cell, so a row that
    // moves repaints its `{i}` WITHOUT rebuilding: the moved row's <span> keeps identity.
    const items = state([
        { id: 1, label: 'a' },
        { id: 2, label: 'b' },
    ])
    const host = run(
        `
        <script></script>
        <template each={items.value} as="item" key="item.id" index="i"><span>{i}:{item.label}</span></template>
    `,
        { items },
    )
    expect(host.textContent).toBe('0:a1:b')
    const firstSpan = find(host, 'span') // row id=1's span, at index 0
    items.value = [
        { id: 2, label: 'b' }, // same objects, reversed order
        { id: 1, label: 'a' },
    ]
    expect(host.textContent).toBe('0:b1:a') // indices repainted to new positions
    // row id=1 moved 0 -> 1; its span is reused (no rebuild) and now reads index 1
    expect(find(host, 'span')?.textContent).toBe('0:b')
})

test('index="i" composes with a destructured as binding', () => {
    const items = state([
        { id: 1, label: 'a' },
        { id: 2, label: 'b' },
    ])
    const host = run(
        `
        <script></script>
        <template each={items.value} as="{ id, label }" key="id" index="i"><span>{i}:{id}:{label}</span></template>
    `,
        { items },
    )
    expect(host.textContent).toBe('0:1:a1:2:b')
})
