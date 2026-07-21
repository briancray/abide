// COMPONENTS-AS-`.abide`-FILES — CROSS-FILE PARITY PROOF (Stage: components-as-files PR2).
//
// Drives a SHARED component source (`Component.abide`) imported by a page via `import Card from
// "./Component.abide"` and used as `<Card prop={x}>…</Card>`, resolved hermetically through the
// `loadEmitted(source, resolve)` component resolver (no filesystem). Proves the file-component:
//   (1) SSR-renders the COMPOSED HTML (page props + slot inside the component),
//   (2) hydrates by CLAIMING the SAME server nodes (identity `===`, no container clear),
//   (3) stays interactive (a `state` button in the component updates in place),
//   (4) is byte-for-byte identical — SSR HTML + claimed-node behavior — to the equivalent inline
//       `{#snippet}`.

import { describe, expect, test } from 'bun:test'
import { state } from '../state.ts'
import { type ComponentResolver, loadEmitted } from './emit.ts'

function tick(): Promise<void> {
    return Promise.resolve()
}

function stripAnchors(html: string): string {
    return html.replace(/<!--\[-->|<!--\]-->|<!---->/g, '')
}

// The client mount adds component/block MARKER comments (`<!--Card-->`, `<!--children-->`) that the
// server HTML (which uses `<!--[-->…<!--]-->` block anchors) does not carry. For comparing post-mount
// DOM shape, drop ALL comments.
function stripComments(html: string): string {
    return html.replace(/<!--[\s\S]*?-->/g, '')
}

// The shared reusable component (exactly the plan's `Component.abide`): a `title` prop + a `{children()}`
// slot, wrapped in a <section>.
const COMPONENT =
    `<script>import { props } from "abide/ui/props"; const { title } = props()</script>` +
    `<section>{title}<div>{children()}</div></section>`

// A page that imports + uses it. `resolve` maps the specifier to the component source.
const PAGE = `<script>import Card from "./Component.abide"</script><Card title="Hi"><p>slot</p></Card>`

const resolve: ComponentResolver = (specifier) =>
    specifier === './Component.abide' ? COMPONENT : undefined

describe('file-component — SSR composition', () => {
    test("render() produces the composed HTML (page prop + slot inside the component's section)", async () => {
        const emitted = await loadEmitted(PAGE, resolve)
        const html = await emitted.render({})
        expect(stripAnchors(html)).toBe('<section>Hi<div><p>slot</p></div></section>')
    })

    test('an unresolved component import fails loudly', async () => {
        await expect(loadEmitted(PAGE)).rejects.toThrow(/no component resolver/)
        await expect(loadEmitted(PAGE, () => undefined)).rejects.toThrow(
            /could not resolve component import/,
        )
    })
})

describe('file-component — hydration claims the SAME server nodes', () => {
    test('hydrate() over the server HTML claims the section + slot <p> without recreating them', async () => {
        const emitted = await loadEmitted(PAGE, resolve)

        const host = document.createElement('div')
        host.innerHTML = await emitted.render({})
        const serverSection = host.querySelector('section')
        if (serverSection === null) throw new Error('expected a server <section>')
        const serverP = host.querySelector('p')
        if (serverP === null) throw new Error('expected a server <p>')
        const serverSectionText = serverSection.firstChild // the "Hi" text node
        if (serverSectionText === null) throw new Error('expected the "Hi" text node')

        emitted.hydrate(host, {})

        // Same Node objects claimed — no container clear, no recreate.
        expect(host.querySelector('section')).toBe(serverSection)
        expect(host.querySelector('p')).toBe(serverP)
        expect(serverSection.firstChild).toBe(serverSectionText)
        // Slot content preserved verbatim.
        const slotDiv = host.querySelector('div')
        if (slotDiv === null) throw new Error('expected a slot <div>')
        expect(slotDiv.textContent).toBe('slot')
        expect(stripComments(host.innerHTML)).toBe('<section>Hi<div><p>slot</p></div></section>')
    })
})

describe('file-component — interactive state', () => {
    const COUNTER =
        `<script>import { state } from "abide/ui/state"; let count = state(0)</script>` +
        `<button onclick={() => count++}>{count}</button>`
    const COUNTER_PAGE = `<script>import Counter from "./Counter.abide"</script><Counter />`
    const counterResolve: ComponentResolver = (s) => (s === './Counter.abide' ? COUNTER : undefined)

    test('a state button inside a file-component updates in place on click', async () => {
        const emitted = await loadEmitted(COUNTER_PAGE, counterResolve)
        const host = document.createElement('div')
        // `state` is inherited from the page scope via the adapter's `Object.create(parentScope)`.
        emitted.mount(host, { state })

        const button = host.querySelector('button')
        if (button === null) throw new Error('expected a <button>')
        expect(button.textContent).toBe('0')
        button.click()
        await tick()
        expect(button.textContent).toBe('1')
        button.click()
        await tick()
        expect(button.textContent).toBe('2')
    })
})

describe('PARITY — file-component === inline {#snippet}', () => {
    // The SAME UI expressed inline: a `{#snippet Card(props, children)}` taking props + the children
    // factory, in one page — vs the file-component in another.
    const INLINE_PAGE =
        `{#snippet Card(props, children)}<section>{props.title}<div>{children()}</div></section>{/snippet}` +
        `<Card title="Hi"><p>slot</p></Card>`

    test('identical SSR HTML (stripped of anchors)', async () => {
        const fileEmitted = await loadEmitted(PAGE, resolve)
        const inlineEmitted = await loadEmitted(INLINE_PAGE)
        const fileHtml = stripAnchors(await fileEmitted.render({}))
        const inlineHtml = stripAnchors(await inlineEmitted.render({}))
        expect(fileHtml).toBe(inlineHtml)
        expect(fileHtml).toBe('<section>Hi<div><p>slot</p></div></section>')
    })

    test('identical claimed-node behavior (both claim the server section + slot <p>)', async () => {
        // File-component.
        const fileEmitted = await loadEmitted(PAGE, resolve)
        const fileHost = document.createElement('div')
        fileHost.innerHTML = await fileEmitted.render({})
        const fileSection = fileHost.querySelector('section')
        if (fileSection === null) throw new Error('expected a file <section>')
        const fileP = fileHost.querySelector('p')
        if (fileP === null) throw new Error('expected a file <p>')
        fileEmitted.hydrate(fileHost, {})
        expect(fileHost.querySelector('section')).toBe(fileSection)
        expect(fileHost.querySelector('p')).toBe(fileP)

        // Inline snippet.
        const inlineEmitted = await loadEmitted(INLINE_PAGE)
        const inlineHost = document.createElement('div')
        inlineHost.innerHTML = await inlineEmitted.render({})
        const inlineSection = inlineHost.querySelector('section')
        if (inlineSection === null) throw new Error('expected an inline <section>')
        const inlineP = inlineHost.querySelector('p')
        if (inlineP === null) throw new Error('expected an inline <p>')
        inlineEmitted.hydrate(inlineHost, {})
        expect(inlineHost.querySelector('section')).toBe(inlineSection)
        expect(inlineHost.querySelector('p')).toBe(inlineP)

        // Same post-hydration DOM.
        expect(stripAnchors(fileHost.innerHTML)).toBe(stripAnchors(inlineHost.innerHTML))
    })
})
