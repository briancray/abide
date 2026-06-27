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
import { switchBlock } from '../src/lib/ui/dom/switchBlock.ts'
import { text } from '../src/lib/ui/dom/text.ts'
import { when } from '../src/lib/ui/dom/when.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { CHILD_PRESENT } from '../src/lib/ui/runtime/CHILD_PRESENT.ts'
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
    switchBlock,
    mount,
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
    return Object.assign(fn, { build: fn })
}

describe('slots (component children)', () => {
    const Card = `<div class="card">{children()}</div>`
    const parent = `
        <script>let name = scope().state('world')</script>
        <Card>Hello {name}!</Card>
    `

    test('client renders parent markup inside the child slot', () => {
        const host = document.createElement('div')
        component(parent, { Card: component(Card) })(host)
        const html = (
            globalThis as unknown as { serializeMiniDom: (h: unknown) => string }
        ).serializeMiniDom(host)
        expect(html).toBe(
            '<!--[--><div class="card"><!--a--><!--[-->Hello world!<!--]--></div><!--]-->',
        )
    })

    test('SSR renders slot content server-side, identical to the client', async () => {
        const CardComponent = component(Card)
        const server = await component(parent, { Card: CardComponent }).render()
        expect(server.html).toBe(
            '<!--[--><div class="card"><!--a--><!--[-->Hello world!<!--]--></div><!--]-->',
        )
    })

    test('the <slot> element is rejected with a migration error', () => {
        expect(() => compileComponent(`<div><slot></slot></div>`)).toThrow(
            /<slot>.*\{children\(\)\}/s,
        )
    })

    test('{#if children} renders fallback via {:else} when no children passed', () => {
        const Box = `<b>{#if children}{children()}{:else}empty{/if}</b>`
        const host = document.createElement('div')
        component(`<Box></Box>`, { Box: component(Box) })(host)
        const html = (
            globalThis as unknown as { serializeMiniDom: (h: unknown) => string }
        ).serializeMiniDom(host)
        expect(html).toContain('empty')
    })

    test('{#if children} renders the slot when children are passed', () => {
        const Box = `<b>{#if children}{children()}{:else}empty{/if}</b>`
        const host = document.createElement('div')
        component(`<Box>hi</Box>`, { Box: component(Box) })(host)
        const html = (
            globalThis as unknown as { serializeMiniDom: (h: unknown) => string }
        ).serializeMiniDom(host)
        expect(html).toContain('hi')
        expect(html).not.toContain('empty')
    })
})

describe('page params via props()', () => {
    test('a page reads route params through props() (client + SSR)', async () => {
        const Page = `<script>const { id } = props()</script><p>{id}</p>`
        const host = document.createElement('div')
        component(Page)(host, { id: () => '42' })
        const html = (
            globalThis as unknown as { serializeMiniDom: (h: unknown) => string }
        ).serializeMiniDom(host)
        expect(html).toContain('42')

        const server = await component(Page).render({ id: () => '42' })
        expect(server.html).toContain('42')
    })
})

describe('layout {#if children} presence (3a)', () => {
    const Layout = `<main>{#if children}<nav>has</nav>{/if}</main>`

    test('renders the presence branch when a child layer exists', () => {
        const host = document.createElement('div')
        component(Layout)(host, { $children: CHILD_PRESENT })
        const html = (
            globalThis as unknown as { serializeMiniDom: (h: unknown) => string }
        ).serializeMiniDom(host)
        expect(html).toContain('has')
    })

    test('skips the presence branch when no child layer exists', () => {
        const host = document.createElement('div')
        component(Layout)(host, {})
        const html = (
            globalThis as unknown as { serializeMiniDom: (h: unknown) => string }
        ).serializeMiniDom(host)
        expect(html).not.toContain('has')
    })
})
