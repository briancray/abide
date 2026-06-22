import { beforeAll, describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { applyResolved } from '../src/lib/ui/dom/applyResolved.ts'
import { attr } from '../src/lib/ui/dom/attr.ts'
import { awaitBlock } from '../src/lib/ui/dom/awaitBlock.ts'
import { each } from '../src/lib/ui/dom/each.ts'
import { hydrate } from '../src/lib/ui/dom/hydrate.ts'
import { on } from '../src/lib/ui/dom/on.ts'
import { skeleton } from '../src/lib/ui/dom/skeleton.ts'
import { switchBlock } from '../src/lib/ui/dom/switchBlock.ts'
import { when } from '../src/lib/ui/dom/when.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { renderToStream } from '../src/lib/ui/renderToStream.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
import { escapeKey } from '../src/lib/ui/runtime/escapeKey.ts'
import { RESUME } from '../src/lib/ui/runtime/RESUME.ts'
import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'
import { state } from '../src/lib/ui/state.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})

const COUNTER = `
    <script>
        let count = scope().state(0)
        function inc() { count += 1 }
    </script>
    <main>
        <button onclick={inc}>count: {count}</button>
    </main>
`

describe('hydrate — adopt server DOM', () => {
    test('claims existing nodes (no re-render) and wires reactivity in place', () => {
        // 1) server render → HTML
        const server = new Function('doc', 'state', 'computed', 'effect', compileSSR(COUNTER))(
            doc,
            state,
            computed,
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
        const runtime = { doc, state, computed, effect, appendText, appendStatic, on }
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
            computed,
            effect,
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
            'computed',
            'effect',
            'model',
            compileSSR(source),
        )(doc, state, computed, effect, model) as SsrRender
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
            computed,
            effect,
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
            'computed',
            'effect',
            'model',
            compileSSR(source),
        )(doc, state, computed, effect, model) as SsrRender
        expect(server.html).toBe('<main><!--a--><!--[--><span>hi</span><!--]--></main>')

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
            computed,
            effect,
            appendText,
            appendStatic,
            on,
            when,
            each,
            escapeKey,
            model,
        }
        const names = Object.keys(runtime)
        const values = names.map((n) => runtime[n as keyof typeof runtime])

        const server = new Function(
            'doc',
            'state',
            'computed',
            'effect',
            'escapeKey',
            'model',
            compileSSR(source),
        )(doc, state, computed, effect, escapeKey, model) as SsrRender
        expect(server.html).toBe(
            '<main><ul><!--a--><!--[--><li>1</li><!--]--><!--[--><li>2</li><!--]--></ul></main>',
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

    test('a write that reconciles a keyed each mid-hydrate builds the row (no claim of a missing SSR node)', () => {
        /* The classic shared-state mismatch: SSR rendered rows from a value the client
           store defaults *empty* to, so the each adopts zero rows; then a sibling (a page
           seeding shared state) writes the real list *synchronously, still inside the
           hydrate pass*. The reconcile must build the new rows fresh — not claim SSR nodes
           that were never adopted (the old code crashed in attr/openChild on a null node). */
        const items = state<string[]>([]) // client default — mismatches the SSR rows below
        const host = document.createElement('div')
        host.innerHTML = '<ul><!--[--><li>a</li><!--]--></ul>'
        const ul = host.childNodes[0] as Node

        let threw: unknown
        hydrate(host, () => {
            try {
                each(
                    ul,
                    () => items.value as string[],
                    (key) => key,
                    (parent, key) => {
                        const sk = skeleton(parent, '<li data-abide-hole></li>')
                        appendText(sk.el[0] as Node, () => key)
                    },
                )
                // a sibling seeds the list while the hydrate cursor is still active
                items.value = ['a']
            } catch (error) {
                threw = error
            }
        })

        expect(threw).toBeUndefined() // no null setAttribute / claim crash
        expect(host.textContent).toContain('a') // the row was built and rendered

        // still reactive after hydrate: append lands
        items.value = ['a', 'b']
        expect(host.textContent).toContain('b')
    })

    test('a write that flips a `when` mid-hydrate builds the branch fresh (no claim of a missing SSR node)', () => {
        /* Same class as the each crash: the branch is absent in the SSR range, so the
           block adopts nothing; a synchronous write flips the condition *still inside the
           hydrate pass*, re-running the effect into its rebuild path. The build must
           create — not claim SSR nodes that were never there (old code crashed on null). */
        const show = state(false) // client default — no branch rendered server-side
        const host = document.createElement('div')
        host.innerHTML = '<div><!--[--><!--]--></div>'
        const root = host.childNodes[0] as Node

        let threw: unknown
        hydrate(host, () => {
            try {
                when(
                    root,
                    () => show.value,
                    (parent) => {
                        const sk = skeleton(parent, '<span data-abide-hole></span>')
                        appendText(sk.el[0] as Node, () => 'on')
                    },
                )
                show.value = true // flip while the hydrate cursor is still active
            } catch (error) {
                threw = error
            }
        })

        expect(threw).toBeUndefined()
        expect(host.textContent).toContain('on')

        // still reactive after hydrate: flips back off
        show.value = false
        expect(host.textContent).not.toContain('on')
    })

    test('a write that flips a `switch` mid-hydrate builds the case fresh (no claim of a missing SSR node)', () => {
        const subject = state('a') // SSR rendered the default case; client picks a real case
        const host = document.createElement('div')
        host.innerHTML = '<div><!--[--><span>def</span><!--]--></div>'
        const root = host.childNodes[0] as Node

        let threw: unknown
        hydrate(host, () => {
            try {
                switchBlock(root, () => subject.value, [
                    {
                        match: () => 'b',
                        render: (parent: Node) => {
                            const sk = skeleton(parent, '<span data-abide-hole></span>')
                            appendText(sk.el[0] as Node, () => 'B')
                        },
                    },
                    {
                        match: undefined,
                        render: (parent: Node) => {
                            const sk = skeleton(parent, '<span data-abide-hole></span>')
                            appendText(sk.el[0] as Node, () => 'def')
                        },
                    },
                ])
                subject.value = 'b' // switch case while the hydrate cursor is still active
            } catch (error) {
                threw = error
            }
        })

        expect(threw).toBeUndefined()
        expect(host.textContent).toContain('B')
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
            computed,
            effect,
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
            'computed',
            'effect',
            'model',
            compileSSR(source),
        )(doc, state, computed, effect, model) as SsrRender
        expect(server.html).toBe('<main><!--a--><!--[--><span>B</span><!--]--></main>')

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

    test('adopts a child component (and its slot) in place', async () => {
        const runtime = {
            doc,
            state,
            computed,
            effect,
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
        const childSource = `<script>const { label } = props()</script><span>Hi {label}</span>`
        const childClient = compileComponent(childSource)
        const childSsr = compileSSR(childSource)
        const greetingBuild = (host: Element, props?: unknown) => {
            new Function('host', '$props', ...names, childClient)(host, props, ...values)
        }
        const Greeting = Object.assign(greetingBuild, {
            render: (props?: unknown, ctx?: unknown): SsrRender | Promise<SsrRender> =>
                new Function('$props', '$ctx', ...names, childSsr)(props, ctx, ...values) as
                    | SsrRender
                    | Promise<SsrRender>,
            build: greetingBuild,
        })

        const parentSource = `<script>let name = scope().state('world')</script><div><Greeting label={name} /></div>`

        // SSR the parent (server-renders the child)
        const server = (await new Function(
            'doc',
            'state',
            'computed',
            'effect',
            'Greeting',
            compileSSR(parentSource),
        )(doc, state, computed, effect, Greeting)) as SsrRender
        expect(server.html).toBe('<div><!--a--><!--[--><span>Hi world</span><!--]--></div>')

        // parse + hydrate
        const host = document.createElement('div')
        host.innerHTML = server.html
        const div = host.childNodes[0] as unknown as { childNodes: unknown[] }
        // the child mounts as a marker range: <!--a-->, <!--[-->, <span>, <!--]-->
        const spanBefore = div.childNodes[2]
        const parentBody = compileComponent(parentSource)
        hydrate(host, (target) => {
            new Function('host', 'Greeting', ...names, parentBody)(target, Greeting, ...values)
        })

        // the child's range markers and span were adopted, not recreated or duplicated
        expect(div.childNodes.length).toBe(4)
        expect(div.childNodes[2]).toBe(spanBefore)
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
            new Function('doc', 'state', 'computed', 'effect', compileSSR(source))(
                doc,
                state,
                computed,
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
            .childNodes[2] as unknown as { childNodes: { textContent: string }[] }
        const firstRowBefore = ul.childNodes[0]
        expect(ul.childNodes.map((row) => row.textContent).filter(Boolean)).toEqual([
            'ada',
            'margaret',
        ])

        // 3) hydrate — adopts the resolved branch from the manifest, no re-fetch
        const runtime = {
            doc,
            state,
            computed,
            effect,
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

    test('hydrates a genuinely-pending await in a skeleton (discard path, no crash)', async () => {
        /* Regression (browser-only until the mini-DOM went strict): the layout's
           `<template await={cache(getSession)()}>` hydrated genuinely pending — no resume,
           not warm-sync — so awaitBlock discards the SSR boundary and rebuilds fresh. It
           inserted its managed anchor before the captured `before` ref, which for a
           skeleton-anchored block IS the await's own open boundary — removed by the discard
           — so the insert referenced a detached node (NotFoundError in WebKit). The insert
           must target the node AFTER the discarded boundary (discardBoundary's return). */
        let resolve: (value: string) => void = () => {}
        const pending = new Promise<string>((r) => {
            resolve = r
        })
        ;(globalThis as { __pendingUser?: () => Promise<string> }).__pendingUser = () => pending
        const source = `<main><template await={__pendingUser()}><p>loading…</p><template then="who"><span>{who}</span></template></template></main>`

        // the server pending shell — the `<!--a-->` anchor precedes the await boundary
        const host = document.createElement('div')
        host.innerHTML =
            '<main><!--a--><!--abide:await:0--><p>loading…</p><!--/abide:await:0--></main>'

        const runtime = { doc, state, computed, effect, appendText, appendStatic, on, awaitBlock }
        const names = Object.keys(runtime)
        const values = names.map((n) => runtime[n as keyof typeof runtime])
        const body = compileComponent(source)
        let threw: unknown
        try {
            hydrate(host, (target) => {
                new Function('host', ...names, body)(target, ...values)
            })
        } catch (error) {
            threw = error
        }
        expect(threw).toBeUndefined() // discard rebuild no longer inserts before a removed node
        expect(host.textContent).toContain('loading') // pending branch rebuilt in place

        resolve('ada')
        await Promise.resolve()
        await Promise.resolve()
        expect(host.textContent).toContain('ada') // resolved branch swapped in, still reactive
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
            computed,
            effect,
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
            'computed',
            'effect',
            'model',
            compileSSR(source),
        )(doc, state, computed, effect, model) as SsrRender
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
    test('adopts an each whose row is a slotted component, after a standalone one (MediaFilters shape)', async () => {
        /* The reported blink, isolated: a container holds a standalone slotted component
           (the "All" button) followed by `{#each}` over more of the SAME slotted component.
           Each row mounts a component (wrapper hole) whose body skeletons its own root +
           slot. If SSR and client disagree on the row's wrapper contents, the row's inner
           skeleton claims an empty run → `resolveElementHole` throws → the enclosing await
           cold-rebuilds the whole subtree (the blink). */
        const childSource = `<script>const { value } = props<{ value: unknown }>()</script><div data-value={value}><slot></slot></div>`
        const childClient = compileComponent(childSource)
        const childSsr = compileSSR(childSource)
        const baseRuntime = {
            doc,
            state,
            computed,
            effect,
            appendText,
            appendStatic,
            on,
            attr,
            when,
            each,
            escapeKey,
        }
        const baseNames = Object.keys(baseRuntime)
        const baseValues = baseNames.map((n) => baseRuntime[n as keyof typeof baseRuntime])
        const selBuild = (host: Element, props?: unknown) => {
            new Function('host', '$props', ...baseNames, childClient)(host, props, ...baseValues)
        }
        const Sel = Object.assign(selBuild, {
            render: (props?: unknown, ctx?: unknown): SsrRender | Promise<SsrRender> =>
                new Function('$props', '$ctx', ...baseNames, childSsr)(props, ctx, ...baseValues) as
                    | SsrRender
                    | Promise<SsrRender>,
            build: selBuild,
        })

        const model = doc({ types: ['movie', 'series'] })
        const parentSource = `
            <div class="types">
                <Sel value={undefined}><button>All</button></Sel>
                <template each={model.types} as="t" key="t"><Sel value={t}><button>{t}</button></Sel></template>
            </div>
        `

        const server = (await new Function(
            'doc',
            'state',
            'computed',
            'effect',
            'escapeKey',
            'Sel',
            'model',
            compileSSR(parentSource),
        )(doc, state, computed, effect, escapeKey, Sel, model)) as SsrRender

        const host = document.createElement('div')
        host.innerHTML = server.html
        const textBefore = host.textContent

        const parentBody = compileComponent(parentSource)
        let threw: unknown
        try {
            hydrate(host, (target) => {
                new Function('host', ...baseNames, 'Sel', 'model', parentBody)(
                    target,
                    ...baseValues,
                    Sel,
                    model,
                )
            })
        } catch (error) {
            threw = error
        }

        expect(threw).toBeUndefined() // each-row component skeleton found its server nodes
        expect(host.textContent).toBe(textBefore) // adopted in place, no cold rebuild
        expect(host.textContent).toContain('All')
        expect(host.textContent).toContain('movie')
        expect(host.textContent).toContain('series')

        // reactive after hydrate: appending a row works
        model.add('types/-', 'season')
        expect(host.textContent).toContain('season')
    })

    test('adopts a bound element hole that a conditional sibling precedes (cards-grid layout)', () => {
        /* The reported home-page blink: a container mixes a conditional `{#if}` sibling
           (server-rendered INLINE) with an unconditional bound element (an element hole,
           resolved by element-only path). On hydrate the conditional's inline content must
           NOT shift the element-hole index — `elementChildAt` skips block-range content at
           depth 0 — or the bound card's binding lands on the conditional's card. */
        const model = doc({
            showWatching: true,
            watchingTitle: 'Watching',
            newTitle: "What's New",
            showPlaylists: true,
        })
        const source = `
            <div class="cards">
                <template if={model.showWatching}><card title={model.watchingTitle}>w</card></template>
                <card title={model.newTitle}>n</card>
                <template if={model.showPlaylists}><card>p</card></template>
            </div>
        `
        const runtime = {
            doc,
            state,
            computed,
            effect,
            appendText,
            appendStatic,
            on,
            attr,
            when,
            model,
        }
        const names = Object.keys(runtime)
        const values = names.map((n) => runtime[n as keyof typeof runtime])

        const server = new Function(
            'doc',
            'state',
            'computed',
            'effect',
            'model',
            compileSSR(source),
        )(doc, state, computed, effect, model) as SsrRender

        const host = document.createElement('div')
        host.innerHTML = server.html
        const cards = host.childNodes[0] as unknown as {
            childNodes: { tagName?: string; getAttribute?: (n: string) => string | null }[]
            children: { getAttribute: (n: string) => string | null }[]
        }
        // element-order [Watching, What's New, Playlists] — the bound What's New card is index 1
        const whatsNewBefore = cards.children[1]
        expect(whatsNewBefore.getAttribute('title')).toBe("What's New")

        const body = compileComponent(source)
        let threw: unknown
        try {
            hydrate(host, (target) => {
                new Function('host', ...names, body)(target, ...values)
            })
        } catch (error) {
            threw = error
        }

        // no hydration desync throw, and the bound card adopted in place (not recreated)
        expect(threw).toBeUndefined()
        expect(cards.children[1]).toBe(whatsNewBefore)
        // the binding wired onto the RIGHT card — not the conditional's Watching card
        expect(cards.children[1].getAttribute('title')).toBe("What's New")
        expect(cards.children[0].getAttribute('title')).toBe('Watching')

        // reactive after hydrate: the binding updates the correct card
        model.replace('newTitle', 'Fresh')
        expect(cards.children[1].getAttribute('title')).toBe('Fresh')
        expect(cards.children[0].getAttribute('title')).toBe('Watching')
    })
})

/* Compile a component body once for the test above. */
function body(source: string): string {
    return compileComponent(source)
}
