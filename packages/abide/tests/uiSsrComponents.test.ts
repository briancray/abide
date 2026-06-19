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
    return Object.assign(fn, { render: fn.render })
}

describe('SSR component composition', () => {
    test('a parent server-renders its child, and SSR matches the client DOM', () => {
        const Greeting = component(`
            <script>let label = prop('label')</script>
            <span>Hi {label}</span>
        `)
        const parentSource = `
            <script>let name = scope().state('world')</script>
            <div><Greeting label={name} /></div>
        `

        // server render — child rendered server-side, inlined in its wrapper
        const server = component(parentSource, { Greeting }).render() as SsrRender
        expect(server.html).toBe('<div><greeting><span>Hi world</span></greeting></div>')

        // client render — should produce the identical tree
        const host = document.createElement('div')
        component(parentSource, { Greeting })(host)
        const clientHtml = (
            globalThis as unknown as { serializeMiniDom: (h: unknown) => string }
        ).serializeMiniDom(host)
        expect(clientHtml).toBe(server.html)
    })

    test('a component named after a void element gets a non-void transparent wrapper', () => {
        /* `Input`→`input` is a VOID tag: a raw `<input>` wrapper self-closes and the
           browser reparents the child's own markup as siblings, so hydration claims
           null inside the empty wrapper and crashes. The wrapper must instead be a
           hyphenated custom element (never void), kept layout-transparent so the
           child's root still lays out as a direct child of the parent. */
        const Input = component(`
            <script>let value = prop('value')</script>
            <input value={value} />
        `)
        const parentSource = `
            <script>let q = scope().state('hi')</script>
            <div><Input value={q} /></div>
        `

        const server = component(parentSource, { Input }).render() as SsrRender
        expect(server.html).toBe(
            '<div><abide-input style="display:contents"><input value="hi"></abide-input></div>',
        )

        const host = document.createElement('div')
        component(parentSource, { Input })(host)
        const clientHtml = (
            globalThis as unknown as { serializeMiniDom: (h: unknown) => string }
        ).serializeMiniDom(host)
        expect(clientHtml).toBe(server.html)
    })
})
