import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { doc } from '../src/lib/ui/doc.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { mount } from '../src/lib/ui/dom/mount.ts'
import { navigate } from '../src/lib/ui/navigate.ts'
import { router } from '../src/lib/ui/router.ts'
import { runtimePath } from '../src/lib/ui/runtime/runtimePath.ts'
import type { NavVerdict } from '../src/lib/ui/runtime/types/NavVerdict.ts'
import type { Route } from '../src/lib/ui/runtime/types/Route.ts'
import { installMiniDom } from './support/installMiniDom.ts'

beforeAll(() => {
    installMiniDom()
})
/* runtimePath is a module singleton — reset it so each test starts at `/` rather
   than wherever the previous test's navigation left it. */
beforeEach(() => {
    runtimePath.value = '/'
})

/* The router imports route chunks on demand, so each mount lands a microtask
   after navigation — drain the queue before asserting. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/* Wrap a resolved page as a code-split loader, the shape the router consumes. */
const loader = (view: Route) => (): Promise<{ default: Route }> =>
    Promise.resolve({ default: view })

describe('router', () => {
    test('mounts the matching page and re-mounts on navigate', async () => {
        const host = document.createElement('div')
        const page =
            (label: string): Route =>
            (target: Element) => {
                target.appendChild(document.createTextNode(label))
                return () => undefined
            }
        const dispose = router(host, {
            '/': loader(page('home')),
            '/about': loader(page('about')),
            '*': loader(page('not found')),
        })

        navigate('/')
        await flush()
        expect(host.textContent).toBe('home')

        navigate('/about')
        await flush()
        expect(host.textContent).toBe('about') // old page cleared, new mounted

        navigate('/missing')
        await flush()
        expect(host.textContent).toBe('not found') // falls back to '*'

        navigate('/')
        await flush()
        expect(host.textContent).toBe('home')

        dispose()
    })

    /* Regression: the router mounts the page inside an effect, so a page's
       build-time reads (each interpolation reads its value once before wrapping
       it in its own effect) must not subscribe the router effect — otherwise an
       in-page state change re-runs the router, re-mounts the page, and drops the
       page's local state. The page must update in place and mount exactly once. */
    test('in-page state change updates in place without re-mounting the page', async () => {
        const host = document.createElement('div')
        let mounts = 0
        let bump: (() => void) | undefined
        const page: Route = (target: Element): (() => void) =>
            mount(target, (host) => {
                mounts += 1
                const model = doc({})
                model.replace('count', 0)
                const cell = model.cell<number>('count')
                bump = () => model.replace('count', cell.get() + 1)
                appendText(host, () => cell.get())
            })

        const dispose = router(host, { '/': loader(page), '*': loader(page) })
        navigate('/')
        await flush()
        expect(host.textContent).toBe('0')
        expect(mounts).toBe(1)

        bump?.()
        expect(host.textContent).toBe('1') // updated in place
        expect(mounts).toBe(1) // not re-mounted

        bump?.()
        expect(host.textContent).toBe('2')
        expect(mounts).toBe(1)

        dispose()
    })

    /* The probe runs each post-boot navigation through app.handle (server-side)
       and gates the mount on its verdict — the first render adopts a document the
       server already ran handle() on, so it isn't probed. */
    test('probes post-boot navigations and mounts when handle() clears them', async () => {
        const host = document.createElement('div')
        const page =
            (label: string): Route =>
            (target: Element) => {
                target.appendChild(document.createTextNode(label))
                return () => undefined
            }
        const probed: string[] = []
        const probe = async (path: string): Promise<NavVerdict> => {
            probed.push(path)
            return { kind: 'mount' }
        }
        const dispose = router(
            host,
            { '/': loader(page('home')), '/about': loader(page('about')), '*': loader(page('x')) },
            {},
            probe,
        )
        await flush()
        expect(host.textContent).toBe('home')
        expect(probed).toEqual([]) // first render adopts the server document, unprobed

        navigate('/about')
        await flush()
        expect(probed).toEqual(['/about']) // navigation ran through the probe
        expect(host.textContent).toBe('about') // cleared → mounted

        dispose()
    })

    test('follows a redirect verdict to the route handle() pointed at', async () => {
        const host = document.createElement('div')
        const page =
            (label: string): Route =>
            (target: Element) => {
                target.appendChild(document.createTextNode(label))
                return () => undefined
            }
        const probe = async (path: string): Promise<NavVerdict> =>
            path === '/admin' ? { kind: 'redirect', path: '/login' } : { kind: 'mount' }
        const dispose = router(
            host,
            {
                '/': loader(page('home')),
                '/admin': loader(page('admin')),
                '/login': loader(page('login')),
                '*': loader(page('x')),
            },
            {},
            probe,
        )
        await flush()

        navigate('/admin')
        await flush()
        // handle() blocked /admin and redirected to /login — the login page mounts.
        expect(host.textContent).toBe('login')

        dispose()
    })

    test('does not mount when the verdict hands off to a full browser load', async () => {
        const host = document.createElement('div')
        const page =
            (label: string): Route =>
            (target: Element) => {
                target.appendChild(document.createTextNode(label))
                return () => undefined
            }
        const probe = async (path: string): Promise<NavVerdict> =>
            path === '/blocked' ? { kind: 'reload', url: '/blocked' } : { kind: 'mount' }
        const dispose = router(
            host,
            {
                '/': loader(page('home')),
                '/blocked': loader(page('blocked')),
                '*': loader(page('x')),
            },
            {},
            probe,
        )
        await flush()
        expect(host.textContent).toBe('home')

        navigate('/blocked')
        await flush()
        // reload verdict defers to the browser; the SPA never swaps the page in.
        expect(host.textContent).toBe('home')

        dispose()
    })
})
