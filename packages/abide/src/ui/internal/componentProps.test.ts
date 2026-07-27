// Components as first-class props: passing a `{#component}` as a prop and invoking it via `<Bar/>`,
// nested-def-as-prop (`<Foo>{#component Body()}…{/component}</Foo>` → Foo's `Body` prop), `<slot/>`
// children, props-object destructure via a tag, and hydration parity for each.

import { describe, expect, test } from 'bun:test'
import { state } from '../../shared/internal/reactive.ts'
import { type ComponentResolver, loadEmitted } from './emit.ts'

function stripAnchors(html: string): string {
    return html.replace(/<!--\[-->|<!--\]-->|<!---->/g, '')
}

// Let the reactive scheduler's queued microtask land the DOM patch before reading the DOM.
async function flush(): Promise<void> {
    await Promise.resolve()
    await Promise.resolve()
}

// A file component that receives another component as the `Body` prop and invokes it as a tag.
const FRAMED =
    `<script>import { props } from "abide/ui/props"; const { Body } = props()</script>` +
    `<div class="framed"><Body/></div>`

// The page defines an inline component `Inner` and passes it as the `Body` prop.
const PAGE =
    `<script>import Framed from "./Framed.abide"</script>` +
    `{#component Inner()}<i>inner</i>{/component}` +
    `<Framed Body={Inner}/>`

const resolve: ComponentResolver = (specifier) =>
    specifier === './Framed.abide' ? FRAMED : undefined

// A nested `{#component Body()}` inside `<Framed>` becomes Framed's `Body` prop.
const PAGE_NESTED =
    `<script>import Framed from "./Framed.abide"</script>` +
    `<Framed>{#component Body()}<i>nested</i>{/component}</Framed>`

describe('component passed as a prop, invoked via <Bar/>', () => {
    test('server renders the passed component inside the receiver', async () => {
        const emitted = await loadEmitted(PAGE, resolve)
        const html = await emitted.render({})
        expect(stripAnchors(html)).toBe('<div class="framed"><i>inner</i></div>')
    })

    test('nested {#component Body} inside <Framed> becomes the Body prop', async () => {
        const emitted = await loadEmitted(PAGE_NESTED, resolve)
        const html = await emitted.render({})
        expect(stripAnchors(html)).toBe('<div class="framed"><i>nested</i></div>')
    })

    test('an INLINE receiver takes a nested-def prop and invokes it via <Header/> + <slot/>', async () => {
        // Both the receiver (Panel) and the passed component (Header) are inline `{#component}` defs in
        // one file — the docs NamedSlotDemo shape. Panel gets `Header` as a prop, renders it, and its
        // `<slot/>` is filled automatically — no `children` param declared.
        const PAGE_PANEL =
            '{#component Panel({ Header })}<section><header><Header/></header><div><slot/></div></section>{/component}' +
            '<Panel>{#component Header()}<h4>Title</h4>{/component}<p>body</p></Panel>'
        const emitted = await loadEmitted(PAGE_PANEL)
        const html = await emitted.render({})
        expect(stripAnchors(html)).toBe(
            '<section><header><h4>Title</h4></header><div><p>body</p></div></section>',
        )
    })

    test('{#component Chip({ text })} invoked <Chip text="x"/> destructures the props object', async () => {
        const PAGE_CHIP =
            '{#component Chip({ text })}<span class="chip">{text}</span>{/component}' +
            '<p><Chip text="alpha"/><Chip text="beta"/></p>'
        const emitted = await loadEmitted(PAGE_CHIP)
        const html = await emitted.render({})
        expect(stripAnchors(html)).toBe(
            '<p><span class="chip">alpha</span><span class="chip">beta</span></p>',
        )
    })

    test('<slot/> renders children (server + hydration parity)', async () => {
        const SLOT_FRAMED =
            `<script>import { props } from "abide/ui/props"; const { title } = props()</script>` +
            `<section>{title}<div><slot/></div></section>`
        const slotResolve: ComponentResolver = (s) =>
            s === './Framed.abide' ? SLOT_FRAMED : undefined
        const SLOT_PAGE = `<script>import Framed from "./Framed.abide"</script><Framed title="Hi"><p>slot</p></Framed>`

        const emitted = await loadEmitted(SLOT_PAGE, slotResolve)
        const host = document.createElement('div')
        host.innerHTML = await emitted.render({})
        expect(stripAnchors(host.innerHTML)).toBe('<section>Hi<div><p>slot</p></div></section>')

        const serverSection = host.querySelector('section')
        const serverP = host.querySelector('p')
        if (serverSection === null || serverP === null) throw new Error('expected server nodes')
        emitted.hydrate(host, {})
        expect(host.querySelector('section')).toBe(serverSection)
        expect(host.querySelector('p')).toBe(serverP)
    })

    test('hydration claims the SAME server nodes for the nested-def-as-prop case', async () => {
        const emitted = await loadEmitted(PAGE_NESTED, resolve)
        const host = document.createElement('div')
        host.innerHTML = await emitted.render({})
        const serverFramed = host.querySelector('.framed')
        const serverI = host.querySelector('i')
        if (serverFramed === null || serverI === null) throw new Error('expected server nodes')

        emitted.hydrate(host, {})

        expect(host.querySelector('.framed')).toBe(serverFramed) // no recreate
        expect(host.querySelector('i')).toBe(serverI)
        expect(serverI.textContent).toBe('nested')
    })
})

// A DECLARED param used to be copied off the props object at mount (`$s.text = $props.text`), which
// reads the caller's getter once — and under the `untrack` that wraps the factory call, so nothing
// subscribed either. Every demo that destructures passes a literal, so the freeze rendered correctly
// forever and only showed up where a prop CHANGES: a `{#for}` row handed a new object, or an index
// prop after a reorder. Params bind through accessors now (`bindLazyPattern`); these fix the shape of
// the emitted binding in place, because the output is identical either way until something moves.
describe('a declared component param tracks its source', () => {
    const scopeOf = (cell: ReturnType<typeof state>): Record<string, unknown> => {
        const scope: Record<string, unknown> = {}
        Object.defineProperty(scope, 'source', { get: () => cell(), enumerable: true })
        return scope
    }

    test('a shorthand destructure ({ t }) is as reactive as the props object', async () => {
        // Both forms in ONE template: `props.t` was always live, so it is the control — a regression
        // that freezes only the destructure keeps this test's first half passing.
        const cell = state('one')
        const emitted = await loadEmitted(
            '{#component D({ t })}<b>{t}</b>{/component}' +
                '{#component P(props)}<i>{props.t}</i>{/component}' +
                '<D t={source}/><P t={source}/>',
        )
        const host = document.createElement('div')
        const scope = scopeOf(cell)
        emitted.mount(host, scope)
        await flush()
        expect(stripAnchors(host.innerHTML)).toBe('<b>one</b><i>one</i>')

        const declared = host.querySelector('b')
        cell.set('two')
        await flush()
        expect(stripAnchors(host.innerHTML)).toBe('<b>two</b><i>two</i>')
        // Patched in place — the component was not torn down and rebuilt to pick the value up.
        expect(host.querySelector('b')).toBe(declared)
    })

    test('a default / rename / rest pattern tracks too (the destructure re-runs per read)', async () => {
        const cell = state(1)
        const emitted = await loadEmitted(
            '{#component R({ a = "dflt", b: renamed, ...rest })}<b>{a}|{renamed}|{rest.extra}</b>{/component}' +
                '<R b={source} extra={source}/>',
        )
        const host = document.createElement('div')
        emitted.mount(host, scopeOf(cell))
        await flush()
        expect(stripAnchors(host.innerHTML)).toBe('<b>dflt|1|1</b>')

        cell.set(9)
        await flush()
        expect(stripAnchors(host.innerHTML)).toBe('<b>dflt|9|9</b>')
    })

    test('a keyed list of components: a moved row re-reads its props, keeping its node', async () => {
        // The shape the freeze actually broke. `item` and `index` both come from the loop, and a
        // reconcile updates them WITHOUT re-mounting the row — so a snapshot binding renders the props
        // the row was created with, forever, while the DOM sits in its new position.
        const cell = state([
            { id: 1, t: 'A' },
            { id: 2, t: 'B' },
            { id: 3, t: 'C' },
        ])
        const emitted = await loadEmitted(
            '{#component Row({ item, index })}<li>{item.t}#{index}</li>{/component}' +
                '<ul>{#for item, i of items by item.id}<Row item={item} index={i}/>{/for}</ul>',
        )
        const scope: Record<string, unknown> = {}
        Object.defineProperty(scope, 'items', { get: () => cell(), enumerable: true })

        // Through hydration, so the claimed-node path is the one under test.
        const host = document.createElement('div')
        const rows = (): string[] =>
            Array.from(host.querySelectorAll('li'), (row) => row.textContent ?? '')
        host.innerHTML = await emitted.render(scope)
        expect(rows()).toEqual(['A#0', 'B#1', 'C#2'])
        const rowA = host.querySelectorAll('li')[0]
        emitted.hydrate(host, scope)

        // Reorder: the index prop is now the row's POSITION, which changed for every survivor.
        cell.set([...cell()].reverse())
        await flush()
        expect(rows()).toEqual(['C#0', 'B#1', 'A#2'])
        // A moved, it was not rebuilt: same node, third position.
        expect(host.querySelectorAll('li')[2]).toBe(rowA)

        // Same keys, fresh objects: the item prop itself changes identity under a row that stays put.
        cell.set(cell().map((row) => ({ id: row.id, t: row.t.toLowerCase() })))
        await flush()
        expect(rows()).toEqual(['c#0', 'b#1', 'a#2'])
        expect(host.querySelectorAll('li')[2]).toBe(rowA)
    })
})
