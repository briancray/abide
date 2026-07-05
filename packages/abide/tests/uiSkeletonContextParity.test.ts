import { beforeAll, describe, expect, test } from 'bun:test'
import { snippet } from '../src/lib/shared/snippet.ts'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { appendSnippet } from '../src/lib/ui/dom/appendSnippet.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { attr } from '../src/lib/ui/dom/attr.ts'
import { awaitBlock } from '../src/lib/ui/dom/awaitBlock.ts'
import { each } from '../src/lib/ui/dom/each.ts'
import { hydrate } from '../src/lib/ui/dom/hydrate.ts'
import { mount } from '../src/lib/ui/dom/mount.ts'
import { on } from '../src/lib/ui/dom/on.ts'
import { switchBlock } from '../src/lib/ui/dom/switchBlock.ts'
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
    appendSnippet,
    appendStatic,
    text,
    attr,
    on,
    each,
    when,
    awaitBlock,
    switchBlock,
    mount,
    snippet,
}

function component(
    source: string,
    extra: Record<string, unknown> = {},
): ((host: Element, props?: unknown) => void) & {
    render: (props?: unknown, ctx?: unknown) => SsrRender | Promise<SsrRender>
} {
    const clientBody = compileComponent(source)
    const ssrBody = compileSSR(source)
    const runtime = { ...RUNTIME, ...extra }
    const names = Object.keys(runtime)
    const values = names.map((name) => runtime[name as keyof typeof runtime])
    const fn = (host: Element, props?: unknown) => {
        new Function('host', '$props', ...names, clientBody)(host, props, ...values)
    }
    fn.render = (props?: unknown, ctx?: unknown): SsrRender | Promise<SsrRender> =>
        new Function('$props', '$ctx', ...names, ssrBody)(props, ctx, ...values) as
            | SsrRender
            | Promise<SsrRender>
    return Object.assign(fn, { render: fn.render, build: fn })
}

function clientHtml(render: (host: Element) => void): string {
    const host = document.createElement('div')
    render(host)
    return (globalThis as unknown as { serializeMiniDom: (h: unknown) => string }).serializeMiniDom(
        host,
    )
}

/*
The hydration-congruence invariant the shared `skeletonContext` pass exists to hold: the
server render-to-string and the client DOM build place `<!--a-->` anchors / range markers
identically, so the client can adopt the server HTML. Both back-ends derive marker
position from the SAME annotation, so a fresh-context boundary (a control-flow branch, a
component's slot content, a `<slot>` fallback, a snippet's body) cannot leak an enclosing
skeleton's anchor on one side but not the other. Each case below puts the boundary inside a
skeletonable parent (a reactive-attr element) — the only place a leak shows — and asserts
server markup equals serialized client DOM. A regression on any back-end fails here.
*/
describe('skeleton-context parity across fresh-context boundaries', () => {
    const Box = `<div class="box">{children()}</div>`

    const cases: Array<{ name: string; source: string }> = [
        {
            name: 'component slot content with a control-flow block',
            source: `
                <script>import { state } from '@abide/abide/ui/state'
let active = state(true)</script>
                <section class={active ? 'on' : 'off'}>
                    <Box>{#if active}<span>shown</span>{/if}</Box>
                </section>`,
        },
        {
            name: 'component slot content with interleaved reactive text',
            source: `
                <script>import { state } from '@abide/abide/ui/state'
let active = state(true)</script>
                <section class={active ? 'on' : 'off'}>
                    <Box><b>x</b>{active}<b>y</b></Box>
                </section>`,
        },
        {
            name: 'nested: control-flow branch holding a component whose slot has a block',
            source: `
                <script>import { state } from '@abide/abide/ui/state'
let active = state(true)</script>
                <section class={active ? 'on' : 'off'}>
                    {#if active}
                        <Box>{#if active}<span>deep</span>{/if}</Box>
                    {/if}
                </section>`,
        },
    ]

    for (const { name, source } of cases) {
        test(name, async () => {
            const server = (await component(source, { Box: component(Box) }).render()) as SsrRender
            const client = clientHtml((host) => component(source, { Box: component(Box) })(host))
            expect(client).toBe(server.html)
        })
    }

    test('snippet body with a control-flow block hydrates without desync', async () => {
        /* A snippet invocation (`{row()}`) wraps its output in server-only
           `<!--abide:snippet-->` markers the client never re-emits (see uiSnippets), so raw
           markup parity doesn't apply — but the snippet BODY must still place skeleton anchors
           identically, or hydration desyncs. Render server-side, then hydrate the client over
           it: the desync guard throws on any anchor mismatch, so a clean adopt proves the
           snippet body's anchors agree. */
        const source = `
            <script>import { state } from '@abide/abide/ui/state'
let active = state(true)</script>
            <section class={active ? 'on' : 'off'}>
                {#snippet row}{#if active}<span>x</span>{/if}{/snippet}
                {row()}
            </section>`
        const built = component(source)
        const host = document.createElement('div')
        host.innerHTML = (await built.render()).html

        const clientBody = compileComponent(source)
        const names = Object.keys(RUNTIME)
        const values = names.map((name) => RUNTIME[name as keyof typeof RUNTIME])
        let threw: unknown
        try {
            hydrate(host, (target) => {
                new Function('host', ...names, clientBody)(target, ...values)
            })
        } catch (error) {
            threw = error
        }
        expect(threw).toBeUndefined() // no [abide] hydration desync
        expect(host.textContent).toBe('x')
    })

    test('slot fallback content with a control-flow block', async () => {
        /* The fallback (the `{:else}` taken when the parent passes no children) is its own
           fresh context inside the child's skeletonable `<aside>`. */
        const Panel = `
            <script>import { state } from '@abide/abide/ui/state'
let open = state(true)</script>
            <aside class={open ? 'open' : 'shut'}>
                {#if children}{children()}{:else}{#if open}<span>fallback</span>{/if}{/if}
            </aside>`
        const server = (await component(Panel).render()) as SsrRender
        const client = clientHtml((host) => component(Panel)(host))
        expect(client).toBe(server.html)
    })
})
