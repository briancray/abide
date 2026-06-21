import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { attr } from '../src/lib/ui/dom/attr.ts'
import { awaitBlock } from '../src/lib/ui/dom/awaitBlock.ts'
import { each } from '../src/lib/ui/dom/each.ts'
import { mount } from '../src/lib/ui/dom/mount.ts'
import { on } from '../src/lib/ui/dom/on.ts'
import { text } from '../src/lib/ui/dom/text.ts'
import { when } from '../src/lib/ui/dom/when.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})

const RUNTIME = {
    doc,
    state,
    computed,
    effect,
    appendText,
    appendStatic,
    text,
    attr,
    on,
    each,
    when,
    awaitBlock,
    mount,
}

/* A server-renderable + mountable component: `Child.render($props)` for SSR and
   `Child(host, $props)` for the client — mirroring compileModule's default export. */
function component(
    source: string,
    extra: Record<string, unknown> = {},
): ((host: Element, props?: unknown) => void) & { render: (props?: unknown) => SsrRender } {
    const clientBody = compileComponent(source)
    const ssrBody = compileSSR(source)
    const runtime = { ...RUNTIME, ...extra }
    const names = Object.keys(runtime)
    const values = names.map((name) => runtime[name as keyof typeof runtime])
    const fn = (host: Element, props?: unknown) => {
        new Function('host', '$props', ...names, clientBody)(host, props, ...values)
    }
    fn.render = (props?: unknown): SsrRender =>
        new Function('$props', ...names, ssrBody)(props, ...values) as SsrRender
    return Object.assign(fn, { render: fn.render, build: fn })
}

describe('SSR component composition', () => {
    test('a parent server-renders its child, and SSR matches the client DOM', () => {
        const Greeting = component(`
            <script>const { label } = props()</script>
            <span>Hi {label}</span>
        `)
        const parentSource = `
            <script>let name = scope().state('world')</script>
            <div><Greeting label={name} /></div>
        `

        // server render — child rendered server-side, inlined in its marker range
        const server = component(parentSource, { Greeting }).render() as SsrRender
        expect(server.html).toBe('<div><!--a--><!--[--><span>Hi world</span><!--]--></div>')

        // client render — should produce the identical tree
        const host = document.createElement('div')
        component(parentSource, { Greeting })(host)
        const clientHtml = (
            globalThis as unknown as { serializeMiniDom: (h: unknown) => string }
        ).serializeMiniDom(host)
        expect(clientHtml).toBe(server.html)
    })

    test('slot content inside a skeletonable parent agrees between SSR and client', () => {
        /* Regression: SSR carries a stateful `inSkeleton` flag the client back-end has no
           equivalent of (its skeleton vs imperative choice is structural). The component
           branch built slot content WITHOUT resetting that flag, so a component sitting
           inside a skeletonable subtree (a reactive-attr parent) leaked `<!--a-->` anchors
           / interleaved-text markers into the slot's server markup — markers the client's
           `componentParts` slot builder never emits. The extra comment shifted the claimed
           server run and an inner skeleton's element hole walked off the end at hydrate.
           The parent's reactive `class` makes `<section>` skeletonable; `Box`'s slot holds a
           control-flow block, the exact shape that leaked. */
        const Box = component(`<div class="box"><slot></slot></div>`)
        const parentSource = `
            <script>let active = scope().state(true)</script>
            <section class={active ? 'on' : 'off'}>
                <Box>
                    <template if={active}><span>shown</span></template>
                </Box>
            </section>
        `

        const server = component(parentSource, { Box }).render() as SsrRender

        const host = document.createElement('div')
        component(parentSource, { Box })(host)
        const clientHtml = (
            globalThis as unknown as { serializeMiniDom: (h: unknown) => string }
        ).serializeMiniDom(host)
        expect(clientHtml).toBe(server.html) // no leaked anchor — server and client agree
    })

    test('a component named after a void element renders fine (no wrapper to go void)', () => {
        /* `Input`→`input` is a VOID tag. The old `<abide-input>` wrapper dodged this by
           being a hyphenated custom element; the marker-range mount has NO wrapper element
           at all, so a component name can never collide with an HTML tag — the child's own
           `<input>` is just emitted between the `[`…`]` markers as a direct child. */
        const Input = component(`
            <script>const { value } = props()</script>
            <input value={value} />
        `)
        const parentSource = `
            <script>let q = scope().state('hi')</script>
            <div><Input value={q} /></div>
        `

        const server = component(parentSource, { Input }).render() as SsrRender
        expect(server.html).toBe('<div><!--a--><!--[--><input value="hi"><!--]--></div>')

        const host = document.createElement('div')
        component(parentSource, { Input })(host)
        const clientHtml = (
            globalThis as unknown as { serializeMiniDom: (h: unknown) => string }
        ).serializeMiniDom(host)
        expect(clientHtml).toBe(server.html)
    })
})
