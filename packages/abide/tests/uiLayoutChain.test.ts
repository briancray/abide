import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { layoutChainForRoute } from '../src/lib/shared/layoutChainForRoute.ts'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { compileModule } from '../src/lib/ui/compile/compileModule.ts'
import { compileSSR } from '../src/lib/ui/compile/compileSSR.ts'
import { appendStatic } from '../src/lib/ui/dom/appendStatic.ts'
import { fillBoundary } from '../src/lib/ui/dom/fillBoundary.ts'
import { outlet } from '../src/lib/ui/dom/outlet.ts'
import { navigate } from '../src/lib/ui/navigate.ts'
import { renderChain } from '../src/lib/ui/renderChain.ts'
import { router } from '../src/lib/ui/router.ts'
import { enterRenderPass } from '../src/lib/ui/runtime/enterRenderPass.ts'
import { exitRenderPass } from '../src/lib/ui/runtime/exitRenderPass.ts'
import { nextBlockId } from '../src/lib/ui/runtime/nextBlockId.ts'
import { PENDING_OUTLET } from '../src/lib/ui/runtime/PENDING_OUTLET.ts'
import { RENDER } from '../src/lib/ui/runtime/RENDER.ts'
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

/* The outlet boundary markers a layout's `<slot/>` lowers to (no `<abide-outlet>` element). */
const O = '<!--abide:outlet-->'
const C = '<!--/abide:outlet-->'

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
/* A stub layer: the router fills it via `.build` (a marker range); a layout calls
   `outlet(host)` to leave its child fill point. */
const route = (build: (host: Element) => void): Route =>
    Object.assign(
        (host: Element) => {
            build(host)
            return () => undefined
        },
        { build: (host: Node) => build(host as Element) },
    )
const loader = (build: (host: Element) => void) => (): Promise<{ default: Route }> =>
    Promise.resolve({ default: route(build) })

const serialize = (host: unknown): string =>
    (globalThis as unknown as { serializeMiniDom: (h: unknown) => string }).serializeMiniDom(host)

/* Mounts a chain of layers into `host` the way the router does: establish the root
   boundary (`outlet(host)`), then fill each layer into the previous layer's `<slot/>`
   boundary (recorded in `PENDING_OUTLET`). Brackets one render pass + claim cursor when
   hydrating, so the layers adopt the SSR DOM in place. */
function mountChain(host: Element, layers: UiComponent[], hydrating = false): void {
    const run = (): void => {
        outlet(host)
        let boundary = PENDING_OUTLET.current!
        layers.forEach((layer, index) => {
            PENDING_OUTLET.current = undefined
            fillBoundary(boundary.open, boundary.close, layer.build, {}, undefined)
            if (index < layers.length - 1) {
                boundary = PENDING_OUTLET.current!
            }
        })
    }
    if (!hydrating) {
        run()
        return
    }
    const previous = RENDER.hydration
    RENDER.hydration = { next: new Map() }
    enterRenderPass()
    try {
        run()
    } finally {
        exitRenderPass()
        RENDER.hydration = previous
    }
}

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
    test('a layout <slot/> lowers to an outlet boundary in both back-ends', () => {
        const module = compileModule('<div class="shell"><slot /></div>', { isLayout: true })
        /* The client build emits the `outlet` boundary call; the SSR markup carries the
           empty boundary the chain composer folds the child into — no `<abide-outlet>`. */
        expect(module).toContain('outlet(')
        expect(module).toContain(`${O}${C}`)
        expect(module).not.toContain('abide-outlet')
        /* It is NOT lowered to the passed-children slot machinery. */
        expect(module).not.toContain('$props.$children')
    })

    test('a non-layout component keeps <slot/> as a passed-children slot', () => {
        const module = compileModule('<div><slot /></div>', { isLayout: false })
        expect(module).toContain('$props.$children')
        expect(module).not.toContain('abide:outlet')
    })

    test('a layout with reactive holes around its <slot/> compiles', () => {
        /* `asOutlet` CLONES every element it descends through (rewriting the `<slot/>` to the
           outlet sentinel), so the shared skeleton context must walk that same rewritten tree
           — feeding it the originals leaves a reactive hole's node-keyed index missing and the
           build throws "skeleton hole not numbered". Regression for the kitchen-sink
           `layout.abide`, whose `<a href={url('/')}>` is such a hole. */
        const source =
            '<div class={shell}><nav><a href={href}>{label}</a></nav><main><slot /></main></div>'
        expect(() => compileComponent(source, true)).not.toThrow()
        expect(compileModule(source, { isLayout: true })).toContain('outlet(')
    })
})

describe('renderChain', () => {
    const view = (render: UiComponent['render']): UiComponent =>
        Object.assign(() => () => undefined, { render }) as unknown as UiComponent

    test('folds the page html into each layout outlet, outermost last, under a root boundary', async () => {
        const ssr = await renderChain(
            [
                view(() => ({
                    html: `<div class="a">${O}${C}</div>`,
                    awaits: [],
                    state: { a: 1 },
                    resume: {},
                })),
                view(() => ({
                    html: `<section>${O}${C}</section>`,
                    awaits: [],
                    state: { b: 2 },
                    resume: {},
                })),
                view(() => ({
                    html: '<main>page</main>',
                    awaits: [],
                    state: { c: 3 },
                    resume: {},
                })),
            ],
            {},
        )
        /* Each layout's empty boundary is filled with the child; the whole chain is wrapped
           in the router's root boundary — no `<abide-outlet>` element anywhere. */
        expect(ssr.html).toBe(
            `${O}<div class="a">${O}<section>${O}<main>page</main>${C}</section>${C}</div>${C}`,
        )
        expect(ssr.state).toEqual({ a: 1, b: 2, c: 3 })
    })

    test('shares one block-id pass so await ids stay unique across layers', async () => {
        /* Stubs draw their id from the SHARED `$ctx` renderChain threads through each
           layer — the real mechanism (no module-global counter), so the layer and page
           get consecutive ids. */
        const layerWithAwait = (tag: string): UiComponent =>
            view((_params, ctx) => {
                const id = ctx?.next ?? 0
                if (ctx) {
                    ctx.next += 1
                }
                return {
                    html: `<${tag}>${O}${C}<!--abide:await:${id}--></${tag}>`,
                    awaits: [{ id, promise: () => Promise.resolve(1), then: async () => '' }],
                    state: {},
                    resume: {},
                }
            })
        const page = view((_params, ctx) => {
            const id = ctx?.next ?? 0
            if (ctx) {
                ctx.next += 1
            }
            return {
                html: `<main><!--abide:await:${id}--></main>`,
                awaits: [{ id, promise: () => Promise.resolve(2), then: async () => '' }],
                state: {},
                resume: {},
            }
        })
        const ssr = await renderChain([layerWithAwait('div'), page], {})
        expect(ssr.awaits.map((block) => block.id)).toEqual([0, 1]) // unique, layer order
    })

    test('throws a clear error when a layout has no outlet', async () => {
        await expect(
            renderChain(
                [
                    view(() => ({
                        html: '<div>no outlet</div>',
                        awaits: [],
                        state: {},
                        resume: {},
                    })),
                    view(() => ({ html: '<main>page</main>', awaits: [], state: {}, resume: {} })),
                ],
                {},
            ),
        ).rejects.toThrow('<slot/> outlet')
    })
})

describe('compiled layout round-trip', () => {
    /* Compiles a `.abide` source to a UiComponent (render + client build), with the
       runtime injected, mirroring compileModule's default export. */
    const RUNTIME = { appendStatic, enterRenderPass, exitRenderPass, nextBlockId }
    const compiled = (source: string, isLayout: boolean): UiComponent => {
        const names = Object.keys(RUNTIME)
        const values = names.map((name) => RUNTIME[name as keyof typeof RUNTIME])
        const clientBody = compileComponent(source, isLayout)
        const ssrBody = compileSSR(source, isLayout)
        const build = (host: Node): void => {
            new Function('host', '$props', ...names, clientBody)(host, {}, ...values)
        }
        const mount = (host: Element): (() => void) => {
            build(host)
            return () => undefined
        }
        return Object.assign(mount, {
            render: (props?: unknown, ctx?: unknown): SsrRender | Promise<SsrRender> =>
                new Function('$props', '$ctx', ...names, ssrBody)(props, ctx, ...values) as
                    | SsrRender
                    | Promise<SsrRender>,
            build,
        }) as unknown as UiComponent
    }

    test('a layout slot carries no style scope onto the folded child (bare boundary)', async () => {
        /* The outlet was once an `<abide-outlet>` element that the client clone stamped the
           slot's style scope onto while SSR emitted it bare — a hydration mismatch. Now it is
           a bare comment boundary on both sides, so the child folds in with no scoped wrapper. */
        const source = '<style>.shell { color: red }</style><div class="shell"><slot /></div>'
        const client = compileComponent(source, true)
        expect(client).toContain('outlet(')
        const ssr = await renderChain(
            [compiled(source, true), compiled('<main>page</main>', false)],
            {},
        )
        expect(ssr.html).toContain(`${O}<main>page</main>${C}`)
    })

    test('the SSR chain and the client-nested chain produce identical markup', async () => {
        const layout = compiled('<div class="shell">[shell]<slot /></div>', true)
        const page = compiled('<main>page</main>', false)

        const ssr = await renderChain([layout, page], {})
        expect(ssr.html).toBe(
            `${O}<div class="shell">[shell]<!--a-->${O}<main>page</main>${C}</div>${C}`,
        )

        /* Client: establish the root boundary, fill the layout, fill the page into its slot
           — the router's nesting, via marker boundaries. */
        const host = document.createElement('div')
        mountChain(host, [layout, page])
        expect(serialize(host)).toBe(ssr.html)
    })

    test('hydration claims the outlet boundary in place, leaving the page nodes for the page', async () => {
        const layout = compiled('<div class="shell">[shell]<slot /></div>', true)
        const page = compiled('<main>page</main>', false)
        const ssr = await renderChain([layout, page], {})

        const host = document.createElement('div')
        host.innerHTML = ssr.html
        /* The <main> the page will adopt — found before hydration. */
        const mainBefore = (host as unknown as { querySelectorAll?: unknown }).querySelectorAll
            ? (host as unknown as { querySelector: (s: string) => unknown }).querySelector('main')
            : findMain(host)

        mountChain(host, [layout, page], true)

        /* The page's <main> was adopted in place, not recreated, and no nodes duplicated. */
        expect(findMain(host)).toBe(mainBefore)
        expect(serialize(host)).toBe(ssr.html)
        expect(host.textContent).toBe('[shell]page')
    })
})

/* The first <main> in document order (the mini-dom has no querySelector). */
function findMain(node: unknown): unknown {
    const element = node as { tagName?: string; childNodes?: unknown[] }
    if (element.tagName?.toLowerCase() === 'main') {
        return node
    }
    for (const child of element.childNodes ?? []) {
        const found = findMain(child)
        if (found !== undefined) {
            return found
        }
    }
    return undefined
}

describe('router layout persistence', () => {
    /* A layout Route that records how many times it builds and leaves an outlet boundary
       the router fills with the next layer. */
    const layout = (label: string) => {
        let mounts = 0
        const build = (host: Node): void => {
            mounts += 1
            host.appendChild(document.createTextNode(`[${label}]`))
            outlet(host)
        }
        const mount = (host: Element): (() => void) => {
            build(host)
            return () => undefined
        }
        const view = Object.assign(mount, { build }) as unknown as Route
        return { view, mounts: () => mounts }
    }
    const page = (label: string) => (host: Element) => {
        host.appendChild(document.createTextNode(label))
        return () => undefined
    }

    test('a shared layout stays mounted across page navigation; the page swaps', async () => {
        const host = document.createElement('div')
        const shell = layout('shell')
        const dispose = router(
            host,
            {
                '/dash': loader((h) => page('home')(h as Element)),
                '/dash/stats': loader((h) => page('stats')(h as Element)),
                '*': loader((h) => page('x')(h as Element)),
            },
            { '/dash': loader(shell.view.build as (h: Element) => void) },
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
            {
                '/a': loader((h) => page('a')(h as Element)),
                '/dash': loader((h) => page('d')(h as Element)),
                '*': loader((h) => page('x')(h as Element)),
            },
            {
                '/': loader(root.view.build as (h: Element) => void),
                '/dash': loader(dashLayout.view.build as (h: Element) => void),
            },
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
