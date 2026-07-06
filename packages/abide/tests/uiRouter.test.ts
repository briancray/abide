import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { page } from '../src/lib/shared/page.ts'
import { pageSlot } from '../src/lib/shared/pageSlot.ts'
import { appendText } from '../src/lib/ui/dom/appendText.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { navigate } from '../src/lib/ui/navigate.ts'
import { router } from '../src/lib/ui/router.ts'
import { clientPage } from '../src/lib/ui/runtime/clientPage.ts'
import { createDoc as doc } from '../src/lib/ui/runtime/createDoc.ts'
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

/* Wrap a stub build fn as a code-split loader, the shape the router consumes. The
   router fills a layer into its outlet boundary via `.build` (a marker range, no
   `<abide-outlet>` element); the callable form is the unused direct-mount API. */
const route = (build: (host: Element) => unknown): Route =>
    Object.assign(
        (host: Element) => {
            build(host)
            return () => undefined
        },
        { build: (host: Node) => void build(host as Element) },
    )
const loader = (build: (host: Element) => unknown) => (): Promise<{ default: Route }> =>
    Promise.resolve({ default: route(build) })

describe('router', () => {
    test('mounts the matching page and re-mounts on navigate', async () => {
        const host = document.createElement('div')
        const page = (label: string) => (target: Element) => {
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
        const page = (target: Node) => {
            mounts += 1
            const model = doc({})
            model.replace('count', 0)
            const cell = model.cell<number>('count')
            bump = () => model.replace('count', cell.get() + 1)
            appendText(target, () => cell.get())
        }

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
        const page = (label: string) => (target: Element) => {
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
        const page = (label: string) => (target: Element) => {
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

    /* Regression: navigating off a `[id]` page must dispose that page BEFORE the new
       route's params publish to the `page` proxy. Publishing first re-runs the outgoing
       leaf's computeds against params that no longer carry `id` (it reads back undefined
       → e.g. `Number(page.params.id)` → NaN → a bogus request) while still mounted.
       With the page disposed first, its effect never observes the new params. */
    test('disposes the outgoing [id] page before publishing the new route params', async () => {
        pageSlot.resolver = () => clientPage.value
        const host = document.createElement('div')
        const seen: (string | undefined)[] = []
        const itemPage = (target: Element) => {
            const stop = effect(() => {
                seen.push(page.params.id)
            })
            target.appendChild(document.createTextNode('item'))
            return stop
        }
        const home = (label: string) => (target: Element) => {
            target.appendChild(document.createTextNode(label))
            return () => undefined
        }
        const dispose = router(host, {
            '/': loader(home('home')),
            '/item/[id]': loader(itemPage),
            '*': loader(home('x')),
        })

        navigate('/item/7')
        await flush()
        expect(seen).toEqual(['7'])

        navigate('/')
        await flush()
        expect(host.textContent).toBe('home')
        // The leaf's scope was disposed before `/`'s params published, so its effect
        // never re-ran against the absent id. It MAY re-run with the unchanged id when
        // `navigating` flips (a harmless repeat of '7'); the invariant is that it never
        // observes the missing id — a `undefined` reading is the bug. toContain checks
        // membership, which (unlike toEqual) a trailing-undefined element can't slip past.
        expect(seen).not.toContain(undefined)
        expect(new Set(seen)).toEqual(new Set(['7']))

        dispose()
        pageSlot.resolver = undefined
        pageSlot.fallback = undefined
    })

    /* `page.navigating` is true from the moment a post-boot navigation starts until
       its destination commits — the window where the chunk imports and the probe runs.
       First paint is exempt (no page to leave). */
    test('flags page.navigating during the resolve window and clears it on commit', async () => {
        pageSlot.resolver = () => clientPage.value
        const host = document.createElement('div')
        const view = (label: string) => (target: Element) => {
            target.appendChild(document.createTextNode(label))
            return () => undefined
        }
        const dispose = router(host, {
            '/': loader(view('home')),
            '/about': loader(view('about')),
            '*': loader(view('x')),
        })

        navigate('/')
        await flush()
        expect(page.navigating).toBe(false) // first paint never flags navigating

        navigate('/about')
        expect(page.navigating).toBe(true) // resolve window: chunk import in flight
        await flush()
        expect(page.navigating).toBe(false) // committed
        expect(host.textContent).toBe('about')

        dispose()
        pageSlot.resolver = undefined
        pageSlot.fallback = undefined
    })

    /* A same-document navigation (only the #hash differs) keeps the live page mounted —
       no teardown — and republishes page.url so an in-page anchor scroll is all that
       happens. A differing query is page data and still rebuilds. */
    test('a hash-only change keeps the page mounted; a query change rebuilds', async () => {
        const host = document.createElement('div')
        let mounts = 0
        const view = (target: Element) => {
            mounts += 1
            target.appendChild(document.createTextNode('page'))
            return () => undefined
        }
        const home = (target: Element) => {
            target.appendChild(document.createTextNode('home'))
            return () => undefined
        }
        const dispose = router(host, {
            '/': loader(home),
            '/page': loader(view),
            '*': loader(home),
        })

        navigate('/page')
        await flush()
        expect(mounts).toBe(1)

        navigate('/page#section')
        await flush()
        expect(mounts).toBe(1) // hash-only — no remount
        expect(clientPage.value.url.hash).toBe('#section') // page.url updated in place

        navigate('/page?q=1')
        await flush()
        expect(mounts).toBe(2) // query differs — full rebuild

        dispose()
    })

    /* A navigation within the same route key — only a path param differs (e.g. stepping
       between episodes on one detail page) — keeps the leaf page mounted and updates it
       through the reactive `page` proxy, no teardown. A differing query still rebuilds. */
    test('a same-route-key param change updates in place without re-mounting the page', async () => {
        pageSlot.resolver = () => clientPage.value
        const host = document.createElement('div')
        let mounts = 0
        const seen: string[] = []
        const itemPage = (target: Element) => {
            mounts += 1
            const stop = effect(() => {
                seen.push(page.params.rest ?? '')
            })
            target.appendChild(document.createTextNode('item'))
            return stop
        }
        const dispose = router(host, {
            '/item/[...rest]': loader(itemPage),
            '*': loader((target: Element) => {
                target.appendChild(document.createTextNode('x'))
                return () => undefined
            }),
        })

        navigate('/item/a')
        await flush()
        expect(mounts).toBe(1)

        navigate('/item/b') // same route key, different path param
        await flush()
        expect(mounts).toBe(1) // in place — not re-mounted
        expect(seen.at(-1)).toBe('b') // the proxy update propagated to the live page

        navigate('/item/c?q=1') // a query is page data — this one rebuilds
        await flush()
        expect(mounts).toBe(2)

        dispose()
        pageSlot.resolver = undefined
        pageSlot.fallback = undefined
    })

    /* A hash hop while a slower full navigation's chunk is still in flight must invalidate
       that navigation, so its late resolution can't rebuild over the page the hash hop keeps
       mounted (the token guard only bails on a NEWER sequence — the shortcut must bump it). */
    test('a hash hop invalidates an in-flight navigation so its late resolve cannot clobber the page', async () => {
        const host = document.createElement('div')
        let landSlow: (chunk: { default: Route }) => void = () => undefined
        const slowLoader = (): Promise<{ default: Route }> =>
            new Promise((resolve) => {
                landSlow = resolve
            })
        const home = (target: Element) => {
            target.appendChild(document.createTextNode('home'))
            return () => undefined
        }
        const slow = route((target: Element) => {
            target.appendChild(document.createTextNode('slow'))
        })
        const dispose = router(host, {
            '/': loader(home),
            '/slow': slowLoader,
            '*': loader(home),
        })

        navigate('/')
        await flush()
        expect(host.textContent).toBe('home')

        navigate('/slow') // chunk import in flight — no swap yet
        await flush()
        expect(host.textContent).toBe('home') // still on the old page

        navigate('/#section') // hash hop on the mounted page; bumps sequence
        await flush()
        expect(clientPage.value.url.hash).toBe('#section')
        expect(host.textContent).toBe('home')

        landSlow({ default: slow }) // the stale navigation resolves late
        await flush()
        expect(host.textContent).toBe('home') // invalidated — not rebuilt over
        expect(clientPage.value.url.hash).toBe('#section')

        dispose()
    })

    test('does not mount when the verdict hands off to a full browser load', async () => {
        const host = document.createElement('div')
        const page = (label: string) => (target: Element) => {
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

    /* Containment: a page that THROWS while mounting (a codegen defect — e.g. a dropped
       runtime import — or a throw in user render) is deterministic; reloading re-runs the
       same failure. The router must surface the error and stay alive, never escalate to the
       reload path (which, in a browser, would loop forever). */
    test('a page that throws while mounting is contained, not reloaded', async () => {
        const host = document.createElement('div')
        const errors: string[] = []
        const originalError = console.error
        console.error = (...args: unknown[]) => {
            errors.push(args.map(String).join(' '))
        }
        try {
            const dispose = router(host, {
                '/boom': loader(() => {
                    throw new Error('render kaboom')
                }),
                '/ok': loader((target) => {
                    target.appendChild(document.createTextNode('ok'))
                }),
            })

            navigate('/boom')
            await flush()
            // Surfaced, not swallowed — and explicitly NOT reloaded.
            expect(errors.some((message) => message.includes('threw while mounting'))).toBe(true)

            // The router is not wedged: a working route still mounts after the failure.
            navigate('/ok')
            await flush()
            expect(host.textContent).toBe('ok')

            dispose()
        } finally {
            console.error = originalError
        }
    })
})
