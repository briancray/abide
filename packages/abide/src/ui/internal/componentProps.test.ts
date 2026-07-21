// Components as first-class props: passing a `{#component}` as a prop and invoking it via `<Bar/>`,
// nested-def-as-prop (`<Foo>{#component Body()}…{/component}</Foo>` → Foo's `Body` prop), `<slot/>`
// children, props-object destructure via a tag, and hydration parity for each.

import { describe, expect, test } from 'bun:test'
import { type ComponentResolver, loadEmitted } from './emit.ts'

function stripAnchors(html: string): string {
    return html.replace(/<!--\[-->|<!--\]-->|<!---->/g, '')
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
