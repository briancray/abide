import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { derived } from '../src/lib/ui/derived.ts'
import { doc } from '../src/lib/ui/doc.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { applyResolved } from '../src/lib/ui/dom/applyResolved.ts'
import { awaitBlock } from '../src/lib/ui/dom/awaitBlock.ts'
import { each } from '../src/lib/ui/dom/each.ts'
import { hydrate } from '../src/lib/ui/dom/hydrate.ts'
import { on } from '../src/lib/ui/dom/on.ts'
import { openChild } from '../src/lib/ui/dom/openChild.ts'
import { switchBlock } from '../src/lib/ui/dom/switchBlock.ts'
import { when } from '../src/lib/ui/dom/when.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { renderToStream } from '../src/lib/ui/renderToStream.ts'
import { RESUME } from '../src/lib/ui/runtime/RESUME.ts'
import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})

const COUNTER = `
    <script>
        let count = state(0)
        function inc() { count += 1 }
    </script>
    <main>
        <button onclick={inc}>count: {count}</button>
    </main>
`

describe('hydrate — adopt server DOM', () => {
    test('claims existing nodes (no re-render) and wires reactivity in place', () => {
        // 1) server render → HTML
        const server = new Function('doc', 'state', 'derived', 'effect', compileSSR(COUNTER))(
            doc,
            state,
            derived,
            effect,
        ) as SsrRender
        expect(server.html).toBe('<main><button>count: 0</button></main>')

        // 2) parse the SSR HTML into a host (as a browser would)
        const host = document.createElement('div')
        host.innerHTML = server.html
        const mainBefore = host.childNodes[0]
        const buttonBefore = (mainBefore as unknown as { childNodes: unknown[] })
            .childNodes[0] as unknown as {
            dispatchEvent: (event: { type: string }) => void
        }

        // 3) hydrate: adopt the existing DOM
        const body = compileComponent(COUNTER)
        const runtime = { doc, state, derived, effect, openChild, appendText, appendStatic, on }
        const names = Object.keys(runtime)
        hydrate(host, (target) => {
            new Function('host', ...names, body)(
                target,
                ...names.map((n) => runtime[n as keyof typeof runtime]),
            )
        })

        // adopted, not recreated: same node identities, no duplication
        expect(host.childNodes.length).toBe(1)
        expect(host.childNodes[0]).toBe(mainBefore) // <main> reused
        expect(host.textContent).toBe('count: 0')

        // reactivity wired onto the existing nodes
        buttonBefore.dispatchEvent({ type: 'click' })
        expect(host.textContent).toBe('count: 1')
        expect(host.childNodes[0]).toBe(mainBefore) // still the same node after update
    })

    test('hydrates adjacent interpolations where one first renders empty, then stays reactive', () => {
        /* `{a}{b}` with b='' server-renders a single merged text node 'Item' — b emits
           no node. Each binding must still claim its own node on hydrate, or b grabs the
           wrong sibling (or null → crash) and a later b update is lost. */
        const model = doc({ a: 'Item', b: '' })
        const source = `<main>{model.a}{model.b}</main>`
        const runtime = {
            doc,
            state,
            derived,
            effect,
            openChild,
            appendText,
            appendStatic,
            on,
            model,
        }
        const names = Object.keys(runtime)
        const values = names.map((n) => runtime[n as keyof typeof runtime])

        const server = new Function(
            'doc',
            'state',
            'derived',
            'effect',
            'model',
            compileSSR(source),
        )(doc, state, derived, effect, model) as SsrRender
        expect(server.html).toBe('<main>Item</main>')

        const host = document.createElement('div')
        host.innerHTML = server.html
        const body = compileComponent(source)
        hydrate(host, (target) => {
            new Function('host', ...names, body)(target, ...values)
        })
        expect(host.textContent).toBe('Item')

        // the empty `b` binding owns its own node, so a later update lands (no crash, no clobber)
        model.replace('b', 'NEW')
        expect(host.textContent).toBe('ItemNEW')
        model.replace('a', 'Row')
        expect(host.textContent).toBe('RowNEW')
    })

    test('adopts an if/else branch in place, then toggles', () => {
        // template-only component with an external doc, so the test can drive it
        const model = doc({ on: true, label: 'hi' })
        const source = `
            <main>
                <template if={model.on}>
                    <span>{model.label}</span>
                    <template else><b>off</b></template>
                </template>
            </main>
        `
        const runtime = {
            doc,
            state,
            derived,
            effect,
            openChild,
            appendText,
            appendStatic,
            on,
            when,
            model,
        }
        const names = Object.keys(runtime)
        const values = names.map((n) => runtime[n as keyof typeof runtime])

        // server render (if true → the span branch)
        const server = new Function(
            'doc',
            'state',
            'derived',
            'effect',
            'model',
            compileSSR(source),
        )(doc, state, derived, effect, model) as SsrRender
        expect(server.html).toBe('<main><!--[--><span>hi</span><!--]--></main>')

        // parse + hydrate
        const host = document.createElement('div')
        host.innerHTML = server.html
        const spanBefore = (host.childNodes[0] as unknown as { childNodes: unknown[] })
            .childNodes[0]
        const body = compileComponent(source)
        hydrate(host, (target) => {
            new Function('host', ...names, body)(target, ...values)
        })

        // the branch node was adopted, not recreated
        const span = (host.childNodes[0] as unknown as { childNodes: unknown[] }).childNodes[0]
        expect(span).toBe(spanBefore)
        expect(host.textContent).toBe('hi')

        // reactive on the adopted node
        model.replace('label', 'yo')
        expect(host.textContent).toBe('yo')

        // toggle to the else branch (built fresh, post-hydration), and back
        model.replace('on', false)
        expect(host.textContent).toBe('off')
        model.replace('on', true)
        expect(host.textContent).toBe('yo')
    })

    test('adopts a keyed each list in place, then stays reactive', () => {
        const model = doc({ order: ['a', 'b'], byId: { a: { n: 1 }, b: { n: 2 }, c: { n: 3 } } })
        const source = `
            <main>
                <ul>
                    <template each={model.order} as="k" key="k"><li>{model.byId[k].n}</li></template>
                </ul>
            </main>
        `
        const runtime = {
            doc,
            state,
            derived,
            effect,
            openChild,
            appendText,
            appendStatic,
            on,
            when,
            each,
            model,
        }
        const names = Object.keys(runtime)
        const values = names.map((n) => runtime[n as keyof typeof runtime])

        const server = new Function(
            'doc',
            'state',
            'derived',
            'effect',
            'model',
            compileSSR(source),
        )(doc, state, derived, effect, model) as SsrRender
        expect(server.html).toBe(
            '<main><ul><!--[--><li>1</li><!--]--><!--[--><li>2</li><!--]--></ul></main>',
        )

        const host = document.createElement('div')
        host.innerHTML = server.html
        const ul = (host.childNodes[0] as unknown as { childNodes: unknown[] })
            .childNodes[0] as unknown as {
            childNodes: { textContent: string }[]
            children: { textContent: string }[]
        }
        const firstRow = ul.children[0] // [.children] skips the per-row range markers
        const body = compileComponent(source)
        hydrate(host, (target) => {
            new Function('host', ...names, body)(target, ...values)
        })

        // rows adopted in place, not recreated
        expect(ul.children[0]).toBe(firstRow)
        expect(ul.childNodes.map((c) => c.textContent).filter(Boolean)).toEqual(['1', '2'])

        // a row field updates in place; appending a row works post-hydration
        model.replace('byId/a/n', 9)
        expect(ul.children[0].textContent).toBe('9')
        model.add('order/-', 'c')
        expect(ul.childNodes.map((c) => c.textContent).filter(Boolean)).toEqual(['9', '2', '3'])
    })

    test('adopts the matching switch case in place, then switches', () => {
        const model = doc({ status: 'b' })
        const source = `
            <main>
                <template switch={model.status}>
                    <template case="'a'"><span>A</span></template>
                    <template case="'b'"><span>B</span></template>
                    <template default><span>?</span></template>
                </template>
            </main>
        `
        const runtime = {
            doc,
            state,
            derived,
            effect,
            openChild,
            appendText,
            appendStatic,
            on,
            when,
            each,
            switchBlock,
            model,
        }
        const names = Object.keys(runtime)
        const values = names.map((n) => runtime[n as keyof typeof runtime])

        const server = new Function(
            'doc',
            'state',
            'derived',
            'effect',
            'model',
            compileSSR(source),
        )(doc, state, derived, effect, model) as SsrRender
        expect(server.html).toBe('<main><!--[--><span>B</span><!--]--></main>')

        const host = document.createElement('div')
        host.innerHTML = server.html
        const spanBefore = (host.childNodes[0] as unknown as { childNodes: unknown[] })
            .childNodes[0]
        const body = compileComponent(source)
        hydrate(host, (target) => {
            new Function('host', ...names, body)(target, ...values)
        })

        expect((host.childNodes[0] as unknown as { childNodes: unknown[] }).childNodes[0]).toBe(
            spanBefore,
        )
        expect(host.textContent).toBe('B')

        model.replace('status', 'a')
        expect(host.textContent).toBe('A')
        model.replace('status', 'zzz')
        expect(host.textContent).toBe('?') // default
    })

    test('adopts a child component (and its slot) in place', () => {
        const runtime = {
            doc,
            state,
            derived,
            effect,
            openChild,
            appendText,
            appendStatic,
            on,
            when,
            each,
            switchBlock,
        }
        const names = Object.keys(runtime)
        const values = names.map((n) => runtime[n as keyof typeof runtime])

        // a child component with a prop, available as client mounter + SSR render
        const childSource = `<script>let label = prop('label')</script><span>Hi {label}</span>`
        const childClient = compileComponent(childSource)
        const childSsr = compileSSR(childSource)
        const Greeting = Object.assign(
            (host: Element, props?: unknown) => {
                new Function('host', '$props', ...names, childClient)(host, props, ...values)
            },
            {
                render: (props?: unknown): SsrRender =>
                    new Function('$props', ...names, childSsr)(props, ...values) as SsrRender,
            },
        )

        const parentSource = `<script>let name = state('world')</script><div><Greeting label={name} /></div>`

        // SSR the parent (server-renders the child)
        const server = new Function(
            'doc',
            'state',
            'derived',
            'effect',
            'Greeting',
            compileSSR(parentSource),
        )(doc, state, derived, effect, Greeting) as SsrRender
        expect(server.html).toBe('<div><greeting><span>Hi world</span></greeting></div>')

        // parse + hydrate
        const host = document.createElement('div')
        host.innerHTML = server.html
        const greeting = (host.childNodes[0] as unknown as { childNodes: unknown[] }).childNodes[0]
        const spanBefore = (greeting as unknown as { childNodes: unknown[] }).childNodes[0]
        const parentBody = compileComponent(parentSource)
        hydrate(host, (target) => {
            new Function('host', 'Greeting', ...names, parentBody)(target, Greeting, ...values)
        })

        // the child's wrapper and span were adopted, not recreated or duplicated
        expect((host.childNodes[0] as unknown as { childNodes: unknown[] }).childNodes.length).toBe(
            1,
        )
        expect((greeting as unknown as { childNodes: unknown[] }).childNodes[0]).toBe(spanBefore)
        expect(host.textContent).toBe('Hi world')
    })

    test('resumes a streamed await branch from the manifest (adopts in place, re-subscribes)', async () => {
        // a call counter: once on the server, then once on resume to re-subscribe so the
        // block stays reactive (cache-invalidate driven). A cache-backed await reads warm
        // on that resume pass — no network re-fetch (see uiCache); this raw promise re-runs.
        let calls = 0
        ;(globalThis as { __fetchUsers?: () => Promise<string[]> }).__fetchUsers = () => {
            calls += 1
            return Promise.resolve(['ada', 'margaret'])
        }
        const source = `
            <main>
                <template await={__fetchUsers()}>
                    <p>loading…</p>
                    <template then="users">
                        <ul><template each={users} as="u" key="u"><li>{u}</li></template></ul>
                    </template>
                </template>
            </main>
        `

        // 1) server render → stream the pending shell, then the resolved fragment
        const render = (): SsrRender =>
            new Function('doc', 'state', 'derived', 'effect', compileSSR(source))(
                doc,
                state,
                derived,
                effect,
            ) as SsrRender
        const chunks: string[] = []
        for await (const chunk of renderToStream(render)) {
            chunks.push(chunk)
        }
        expect(calls).toBe(1) // awaited once, on the server
        expect(chunks[0]).toContain('loading…') // pending shell painted first

        // 2) apply the streamed frame: swaps the resolved branch in + registers resume
        const host = document.createElement('div')
        host.innerHTML = chunks[0]
        for (const frame of chunks.slice(1)) {
            applyResolved(host, frame)
        }
        expect(RESUME[0]).toEqual({ ok: true, value: ['ada', 'margaret'] })
        const ul = (host.childNodes[0] as unknown as { childNodes: unknown[] })
            .childNodes[1] as unknown as { childNodes: { textContent: string }[] }
        const firstRowBefore = ul.childNodes[0]
        expect(ul.childNodes.map((row) => row.textContent).filter(Boolean)).toEqual([
            'ada',
            'margaret',
        ])

        // 3) hydrate — adopts the resolved branch from the manifest, no re-fetch
        const runtime = {
            doc,
            state,
            derived,
            effect,
            openChild,
            appendText,
            appendStatic,
            on,
            when,
            each,
            awaitBlock,
        }
        const names = Object.keys(runtime)
        const values = names.map((n) => runtime[n as keyof typeof runtime])
        const body = compileComponent(source)
        hydrate(host, (target) => {
            new Function('host', ...names, body)(target, ...values)
        })

        expect(calls).toBe(2) // re-read once on resume to re-subscribe (raw promise re-runs; cache reads warm)
        expect(ul.childNodes[0]).toBe(firstRowBefore) // rows adopted from the manifest, not recreated
        expect(ul.childNodes.map((row) => row.textContent).filter(Boolean)).toEqual([
            'ada',
            'margaret',
        ])

        delete RESUME[0] // the manifest is process-global; don't leak into other tests
    })

    test('adopts a multi-root if/else branch in place', () => {
        // The body roots must line up with the SSR nodes during adoption; with no
        // per-component <style> emitted, the else <p> is claimed where it stands.
        const model = doc({ total: 0 })
        const source = `
            <section>
                <button>a</button>
                <button>b</button>
                <template if={model.total}><ul></ul><template else><p class="empty">empty</p></template></template>
            </section>
        `
        const runtime = {
            doc,
            state,
            derived,
            effect,
            openChild,
            appendText,
            appendStatic,
            on,
            when,
            each,
            switchBlock,
            model,
        }
        const names = Object.keys(runtime)
        const values = names.map((n) => runtime[n as keyof typeof runtime])
        const server = new Function(
            'doc',
            'state',
            'derived',
            'effect',
            'model',
            compileSSR(source),
        )(doc, state, derived, effect, model) as SsrRender
        // No <style> in the SSR markup — the scoped sheet is linked by the shell.
        expect(server.html).not.toContain('<style>')

        const host = document.createElement('div')
        host.innerHTML = server.html
        const section = host.childNodes[0] as unknown as {
            childNodes: { tagName?: string; textContent: string }[]
            children: { textContent: string }[]
        }
        const pBefore = section.children[2] // the two buttons, then the else <p> (markers skipped)

        hydrate(host, (target) => {
            new Function('host', ...names, body(source))(target, ...values)
        })

        // the else <p> was adopted in place, not built over a shifted node
        expect(section.children[2]).toBe(pBefore)
        expect((pBefore as { textContent: string }).textContent).toBe('empty')

        // reactive after hydrate: showing the list swaps the empty branch for the ul
        model.replace('total', 1)
        const tags = section.childNodes.map((node) => node.tagName).filter(Boolean)
        expect(tags).toContain('ul') // then-branch now shown
        expect(tags).not.toContain('p') // empty branch removed
    })
})

/* Compile a component body once for the test above. */
function body(source: string): string {
    return compileComponent(source)
}
