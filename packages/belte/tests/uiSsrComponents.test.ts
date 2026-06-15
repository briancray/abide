import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { derived } from '../src/lib/ui/derived.ts'
import { doc } from '../src/lib/ui/doc.ts'
import { attr } from '../src/lib/ui/dom/attr.ts'
import { awaitBlock } from '../src/lib/ui/dom/awaitBlock.ts'
import { each } from '../src/lib/ui/dom/each.ts'
import { mount } from '../src/lib/ui/dom/mount.ts'
import { on } from '../src/lib/ui/dom/on.ts'
import { text } from '../src/lib/ui/dom/text.ts'
import { when } from '../src/lib/ui/dom/when.ts'
import { effect } from '../src/lib/ui/effect.ts'
import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})

const RUNTIME = { doc, state, derived, effect, text, attr, on, each, when, awaitBlock, mount }

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
            <script>let name = state('world')</script>
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
})
