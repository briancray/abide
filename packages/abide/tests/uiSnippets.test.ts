import { beforeAll, describe, expect, test } from 'bun:test'
import {
    type Snippet,
    type SnippetValue,
    snippet,
    snippetPayload,
} from '../src/lib/shared/snippet.ts'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { appendSnippet } from '../src/lib/ui/dom/appendSnippet.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { attr } from '../src/lib/ui/dom/attr.ts'
import { each } from '../src/lib/ui/dom/each.ts'
import { hydrate } from '../src/lib/ui/dom/hydrate.ts'
import { mount } from '../src/lib/ui/dom/mount.ts'
import { on } from '../src/lib/ui/dom/on.ts'
import { when } from '../src/lib/ui/dom/when.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import { scope } from '../src/lib/ui/runtime/scope.ts'
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
    attr,
    on,
    each,
    when,
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

const serialize = (host: unknown): string =>
    (globalThis as unknown as { serializeMiniDom: (h: unknown) => string }).serializeMiniDom(host)

test('Snippet<Args> is a callable returning a SnippetValue', () => {
    // A zero-arg snippet prop (like `children`) is invoked with no args.
    const children: Snippet = () => snippet((host: unknown) => void host)
    const value: SnippetValue = children()
    expect(typeof snippetPayload(value)).toBe('function')

    // An arg-taking snippet prop, invoked with its args.
    const row: Snippet<[number]> = (n) => snippet(`row ${n}`)
    expect(snippetPayload(row(3))).toBe('row 3')
})

describe('snippets ({#snippet name(args)} called like a function)', () => {
    /* A snippet that closes over the component scope (`prefix`) and takes an arg. */
    const source = `
        <script>import { state } from '@abide/abide/ui/state'
let prefix = state('#')</script>
        {#snippet item(label)}<li>{prefix}{label}</li>{/snippet}
        <ul>{item('a')}{item('b')}</ul>
    `

    test('client mounts the snippet at each call, with args + captured scope', () => {
        const host = document.createElement('div')
        component(source)(host)
        expect(serialize(host)).toBe(
            '<ul>' +
                '<!--abide:snippet--><li>#a</li><!--/abide:snippet-->' +
                '<!--abide:snippet--><li>#b</li><!--/abide:snippet-->' +
                '</ul>',
        )
    })

    test('SSR renders each call between snippet markers', async () => {
        const html = (await component(source).render()).html
        expect(html).toBe(
            '<ul>' +
                '<!--abide:snippet--><li>#a</li><!--/abide:snippet-->' +
                '<!--abide:snippet--><li>#b</li><!--/abide:snippet-->' +
                '</ul>',
        )
    })

    test('hydration adopts the server-rendered snippet nodes in place', async () => {
        const host = document.createElement('div')
        host.innerHTML = (await component(source).render()).html
        const ul = host.childNodes[0] as unknown as { childNodes: unknown[] }
        const firstLi = ul.childNodes[1] // [0] is the open marker comment

        const clientBody = compileComponent(source)
        const names = Object.keys(RUNTIME)
        const values = names.map((name) => RUNTIME[name as keyof typeof RUNTIME])
        hydrate(host, (target) => {
            new Function('host', ...names, clientBody)(target, ...values)
        })

        expect(ul.childNodes[1]).toBe(firstLi) // adopted, not recreated
        expect(host.textContent).toBe('#a#b')
    })

    test('a snippet call is reactive in its argument: a later write re-mounts it', () => {
        /* The bug this guards: a `{snippet(arg)}` whose arg derives from state was read
           once at mount, freezing the initial value (e.g. grouping an array still empty
           at mount, populated a tick later). The call must re-read its arg reactively.
           Direct-runtime probe — `row(list)` mirrors the compiler's snippet output. */
        const row = (list: number[]) =>
            snippet((target: Node) => {
                target.appendChild(document.createTextNode(list.join(',')))
            })
        const host = document.createElement('div')
        const items = state<number[]>([])
        scope(() => appendSnippet(host, () => row(items.value)))

        expect(host.textContent).toBe('') // arg was [] at mount
        items.value = [1, 2, 3]
        expect(host.textContent).toBe('1,2,3') // re-read the arg, re-mounted
    })

    test('an object arg destructures ({#snippet pair({ a, b })})', async () => {
        const src = `
            {#snippet pair({ a, b })}<span>{a}-{b}</span>{/snippet}
            <div>{pair({ a: 1, b: 2 })}</div>
        `
        const host = document.createElement('div')
        component(src)(host)
        expect(serialize(host)).toBe(
            '<div><!--abide:snippet--><span>1-2</span><!--/abide:snippet--></div>',
        )
        expect((await component(src).render()).html).toBe(
            '<div><!--abide:snippet--><span>1-2</span><!--/abide:snippet--></div>',
        )
    })

    /* A snippet arg whose name matches a component signal must SHADOW it — read the passed
       argument, not the signal. The arg is a plain call parameter on both sides; the body
       lowered as a separate parse used to rewrite `item` to the signal read, rendering the
       signal value on both sides (congruent but wrong). */
    test('an arg named like a component state shadows the state', async () => {
        const src = `
            <script>import { state } from '@abide/abide/ui/state'
let item = state('STATE')</script>
            {#snippet row(item)}<b>{item}</b>{/snippet}
            <div>{row('ARG')}</div>
        `
        const expected = '<div><!--abide:snippet--><b>ARG</b><!--/abide:snippet--></div>'
        const host = document.createElement('div')
        component(src)(host)
        expect(serialize(host)).toBe(expected)
        expect((await component(src).render()).html).toBe(expected)
    })

    test('the <template name> declaration is rejected with a migration error', () => {
        expect(() => compileComponent(`<template name="row">x</template>`)).toThrow(
            /<template name>.*\{#snippet/s,
        )
    })
})

describe('snippets passed across components', () => {
    /* The parent defines a snippet closing over its own `prefix` and hands it to the
       child as a prop; the child calls it like a function. The body still reads the
       PARENT's scope. */
    const List = `<script>import { props } from '@abide/abide/ui/props'
const { item } = props()</script><ul>{item('x')}{item('y')}</ul>`
    const parent = `
        <script>import { state } from '@abide/abide/ui/state'
let prefix = state('•')</script>
        {#snippet row(label)}<li>{prefix}{label}</li>{/snippet}
        <List item={row} />
    `

    test('client: child mounts the parent snippet, capturing parent scope', () => {
        const host = document.createElement('div')
        component(parent, { List: component(List) })(host)
        expect(serialize(host)).toBe(
            '<!--[--><ul>' +
                '<!--abide:snippet--><li>•x</li><!--/abide:snippet-->' +
                '<!--abide:snippet--><li>•y</li><!--/abide:snippet-->' +
                '</ul><!--]-->',
        )
    })

    test('SSR: identical, snippet rendered inside the child', async () => {
        const html = (await component(parent, { List: component(List) }).render()).html
        expect(html).toBe(
            '<!--[--><ul>' +
                '<!--abide:snippet--><li>•x</li><!--/abide:snippet-->' +
                '<!--abide:snippet--><li>•y</li><!--/abide:snippet-->' +
                '</ul><!--]-->',
        )
    })
})
