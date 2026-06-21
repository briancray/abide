import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { layoutChainForRoute } from '../src/lib/shared/layoutChainForRoute.ts'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileModule } from '../src/lib/ui/compile/compileModule.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { hydrate } from '../src/lib/ui/dom/hydrate.ts'
import { navigate } from '../src/lib/ui/navigate.ts'
import { renderChain } from '../src/lib/ui/renderChain.ts'
import { router } from '../src/lib/ui/router.ts'
import { enterRenderPass } from '../src/lib/ui/runtime/enterRenderPass.ts'
import { exitRenderPass } from '../src/lib/ui/runtime/exitRenderPass.ts'
import { firstOutlet } from '../src/lib/ui/runtime/firstOutlet.ts'
import { nextBlockId } from '../src/lib/ui/runtime/nextBlockId.ts'
import { runtimePath } from '../src/lib/ui/runtime/runtimePath.ts'
import type { Route } from '../src/lib/ui/runtime/types/Route.ts'
import type { SsrRender } from '../src/lib/ui/runtime/types/SsrRender.ts'
import type { UiComponent } from '../src/lib/ui/runtime/types/UiComponent.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})
beforeEach(() => {
    runtimePath.value = '/'
})

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
const loader = (view: Route) => (): Promise<{ default: Route }> =>
    Promise.resolve({ default: view })

describe('layoutChainForRoute', () => {
    test('returns every ancestor layout, outermost first', () => {
        const keys = ['/', '/dash', '/dash/settings', '/other']
        expect(layoutChainForRoute('/dash/settings', keys)).toEqual([
            '/',
            '/dash',
            '/dash/settings',
        ])
        expect(layoutChainForRoute('/dash', keys)).toEqual(['/', '/dash'])
        expect(layoutChainForRoute('/', keys)).toEqual(['/'])
    })

    test('matches dynamic segments literally and ignores non-ancestors', () => {
        const keys = ['/', '/media', '/media/[id]']
        expect(layoutChainForRoute('/media/[id]', keys)).toEqual(['/', '/media', '/media/[id]'])
        expect(layoutChainForRoute('/other', keys)).toEqual(['/'])
    })
})

describe('layout compiler outlet', () => {
    test('a layout <slot/> lowers to a <abide-outlet> in both back-ends', () => {
        const module = compileModule('<div class="shell"><slot /></div>', { isLayout: true })
        /* The outlet is a bare empty `<abide-outlet>` placeholder in both the SSR markup
           and the client clone — the router fills it later (firstOutlet finds it). */
        expect(module).toContain('<abide-outlet></abide-outlet>')
        /* It is NOT lowered to the passed-children slot machinery. */
        expect(module).not.toContain('$props.$children')
    })

    test('a non-layout component keeps <slot/> as a passed-children slot', () => {
        const module = compileModule('<div><slot /></div>', { isLayout: false })
        expect(module).toContain('$props.$children')
        expect(module).not.toContain('abide-outlet')
    })

    test('a layout with reactive holes around its <slot/> compiles', () => {
        /* `asOutlet` CLONES every element it descends through (rewriting the `<slot/>` to
           `<abide-outlet>`), so the shared skeleton context must walk that same rewritten
           tree — feeding it the originals leaves a reactive hole's node-keyed index missing
           and the build throws "skeleton hole not numbered". Regression for the
           kitchen-sink `layout.abide`, whose `<a href={url('/')}>` is such a hole. */
        const source =
            '<div class={shell}><nav><a href={href}>{label}</a></nav><main><slot /></main></div>'
        expect(() => compileComponent(source, true)).not.toThrow()
        expect(compileModule(source, { isLayout: true })).toContain('<abide-outlet></abide-outlet>')
    })
})

describe('renderChain', () => {
    const view = (render: () => SsrRender): UiComponent =>
        Object.assign(() => () => undefined, { render }) as unknown as UiComponent

    test('folds the page html into each layout outlet, outermost last', () => {
        const ssr = renderChain(
            [
                view(() => ({ html: '<header><slot/></header>', awaits: [], state: {} })), // never reached
                view(() => ({
                    html: '<div class="a"><abide-outlet></abide-outlet></div>',
                    awaits: [],
                    state: { a: 1 },
                })),
                view(() => ({
                    html: '<section><abide-outlet></abide-outlet></section>',
                    awaits: [],
                    state: { b: 2 },
                })),
                view(() => ({ html: '<main>page</main>', awaits: [], state: { c: 3 } })),
            ].slice(1),
            {},
        )
        /* The outlet elements are kept (live mount containers), child folded inside. */
        expect(ssr.html).toBe(
            '<div class="a"><abide-outlet><section><abide-outlet><main>page</main></abide-outlet></section></abide-outlet></div>',
        )
        expect(ssr.state).toEqual({ a: 1, b: 2, c: 3 })
    })

    test('shares one block-id pass so await ids stay unique across layers', () => {
        const layerWithAwait = (tag: string): UiComponent =>
            view(() => {
                const id = nextBlockId()
                return {
                    html: `<${tag}><abide-outlet></abide-outlet><!--abide:await:${id}--></${tag}>`,
                    awaits: [{ id, promise: () => Promise.resolve(1), then: () => '' }],
                    state: {},
                }
            })
        const page = view(() => {
            const id = nextBlockId()
            return {
                html: `<main><!--abide:await:${id}--></main>`,
                awaits: [{ id, promise: () => Promise.resolve(2), then: () => '' }],
                state: {},
            }
        })
        const ssr = renderChain([layerWithAwait('div'), page], {})
        expect(ssr.awaits.map((block) => block.id)).toEqual([0, 1]) // unique, layer order
    })

    test('throws a clear error when a layout has no outlet', () => {
        expect(() =>
            renderChain(
                [
                    view(() => ({ html: '<div>no outlet</div>', awaits: [], state: {} })),
                    view(() => ({ html: '<main>page</main>', awaits: [], state: {} })),
                ],
                {},
            ),
        ).toThrow('<slot/> outlet')
    })
})

describe('compiled layout round-trip', () => {
    /* Compiles a `.abide` source to a UiComponent (render + client mount), with the
       runtime injected, mirroring compileModule's default export. */
    const RUNTIME = { appendStatic, enterRenderPass, exitRenderPass, nextBlockId }
    const compiled = (source: string, isLayout: boolean): UiComponent => {
        const names = Object.keys(RUNTIME)
        const values = names.map((name) => RUNTIME[name as keyof typeof RUNTIME])
        const clientBody = compileComponent(source, isLayout)
        const ssrBody = compileSSR(source, isLayout)
        const fn = (host: Element) => {
            new Function('host', '$props', ...names, clientBody)(host, {}, ...values)
            return () => undefined
        }
        return Object.assign(fn, {
            render: (props?: unknown) =>
                new Function('$props', ...names, ssrBody)(props, ...values) as SsrRender,
        }) as unknown as UiComponent
    }

    test('a scoped layout emits a bare outlet on BOTH sides (no style scope on the mount container)', () => {
        /* The outlet is a structural mount container, not styled content. The client cloned it
           WITH the slot's annotated style scope while SSR emitted it bare — a hydration mismatch,
           and `renderChain` folds the child into the exact bare `<abide-outlet></abide-outlet>`
           string. The shared `asOutlet` strips the scope so both back-ends agree. */
        const source = '<style>.shell { color: red }</style><div class="shell"><slot /></div>'
        const client = compileComponent(source, true)
        /* The client clone carries the outlet bare — no attrs, no `data-a-…` scope. */
        expect(client).toContain('<abide-outlet></abide-outlet>')
        expect(client).not.toMatch(/<abide-outlet[^>]+>/)
        /* And the SSR render folds the page into that same bare placeholder. */
        const ssr = renderChain([compiled(source, true), compiled('<main>page</main>', false)], {})
        expect(ssr.html).toContain('<abide-outlet><main>page</main></abide-outlet>')
    })

    test('the SSR chain and the client-nested chain produce identical markup', () => {
        const layout = compiled('<div class="shell">[shell]<slot /></div>', true)
        const page = compiled('<main>page</main>', false)

        const ssr = renderChain([layout, page], {})
        expect(ssr.html).toBe(
            '<div class="shell">[shell]<abide-outlet><main>page</main></abide-outlet></div>',
        )

        /* Client: mount the layout, then the page into its outlet — the router's nesting. */
        const host = document.createElement('div')
        layout(host)
        const outlet = firstOutlet(host)
        expect(outlet).toBeDefined()
        page(outlet as Element)
        const clientHtml = (
            globalThis as unknown as { serializeMiniDom: (h: unknown) => string }
        ).serializeMiniDom(host)
        expect(clientHtml).toBe(ssr.html)
    })

    test('hydration claims the outlet in place, leaving the page nodes for the page', () => {
        const layoutSource = '<div class="shell">[shell]<slot /></div>'
        const pageSource = '<main>page</main>'
        const ssr = renderChain([compiled(layoutSource, true), compiled(pageSource, false)], {})

        const host = document.createElement('div')
        host.innerHTML = ssr.html
        const outletBefore = firstOutlet(host) as Element
        const mainBefore = (outletBefore as unknown as { childNodes: unknown[] }).childNodes[0]

        const names = Object.keys(RUNTIME)
        const values = names.map((name) => RUNTIME[name as keyof typeof RUNTIME])
        const hydrateLayer = (target: Element, source: string, isLayout: boolean): void => {
            const body = compileComponent(source, isLayout)
            hydrate(target, (inner) => {
                new Function('host', ...names, body)(inner, ...values)
            })
        }

        /* The router hydrates layer-by-layer: layout into host, page into its outlet. */
        hydrateLayer(host, layoutSource, true)
        const outletAfter = firstOutlet(host) as Element
        expect(outletAfter).toBe(outletBefore) // the outlet element was claimed, not rebuilt
        hydrateLayer(outletAfter, pageSource, false)

        /* The page's <main> was adopted in place inside the outlet, not recreated. */
        expect((outletAfter as unknown as { childNodes: unknown[] }).childNodes[0]).toBe(mainBefore)
        expect(host.textContent).toBe('[shell]page')
    })
})

describe('router layout persistence', () => {
    /* A layout Route that records how many times it mounts and renders an outlet
       the router fills with the next layer. */
    const layout = (label: string) => {
        let mounts = 0
        const view: Route = (host: Element) => {
            mounts += 1
            host.appendChild(document.createTextNode(`[${label}]`))
            host.appendChild(document.createElement('abide-outlet'))
            return () => undefined
        }
        return { view, mounts: () => mounts }
    }
    const page =
        (label: string): Route =>
        (host: Element) => {
            host.appendChild(document.createTextNode(label))
            return () => undefined
        }

    test('a shared layout stays mounted across page navigation; the page swaps', async () => {
        const host = document.createElement('div')
        const shell = layout('shell')
        const dispose = router(
            host,
            {
                '/dash': loader(page('home')),
                '/dash/stats': loader(page('stats')),
                '*': loader(page('x')),
            },
            { '/dash': loader(shell.view) },
        )

        runtimePath.value = '/dash'
        await flush()
        expect(host.textContent).toContain('[shell]')
        expect(host.textContent).toContain('home')
        expect(shell.mounts()).toBe(1)

        navigate('/dash/stats')
        await flush()
        expect(host.textContent).toContain('stats') // page swapped
        expect(host.textContent).not.toContain('home')
        expect(host.textContent).toContain('[shell]') // layout still there
        expect(shell.mounts()).toBe(1) // layout was NOT re-mounted — it persisted

        dispose()
    })

    test('a divergent leaf layout is torn down and rebuilt', async () => {
        const host = document.createElement('div')
        const root = layout('root')
        const dashLayout = layout('dash')
        const dispose = router(
            host,
            { '/a': loader(page('a')), '/dash': loader(page('d')), '*': loader(page('x')) },
            { '/': loader(root.view), '/dash': loader(dashLayout.view) },
        )

        runtimePath.value = '/a'
        await flush()
        expect(host.textContent).toContain('[root]')
        expect(host.textContent).not.toContain('[dash]')
        expect(root.mounts()).toBe(1)

        navigate('/dash')
        await flush()
        expect(host.textContent).toContain('[root]') // root layout shared → persisted
        expect(host.textContent).toContain('[dash]') // dash layout added beneath it
        expect(root.mounts()).toBe(1) // root not re-mounted
        expect(dashLayout.mounts()).toBe(1)

        dispose()
    })
})
