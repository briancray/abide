import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { navigate } from '../src/lib/ui/navigate.ts'
import { router } from '../src/lib/ui/router.ts'
import { runtimePath } from '../src/lib/ui/runtime/runtimePath.ts'
import type { Route } from '../src/lib/ui/runtime/types/Route.ts'
import { installMiniDom } from './support/installMiniDom.ts'

/*
Hydration-mismatch recovery (audit edge #1). A HYDRATING first paint that throws a claim
divergence — the outlet/text/structure asserts fire only while adopting SSR DOM — must not leave
a dead page. The router catches the throw and re-renders the page COLD (no claim cursor, so the
asserts can't fire): pending reads show their empty state and fill in on settle. The canonical
trigger is a blocking async cell whose resolved value the server could NOT serialize into
`__SSR__.cells` (an unserializable value the renderer drops with a warn), so the client reads
pending where the SSR HTML baked a value → an `assertClaimedText` desync. Here we stand in for the
whole class with a `hydratable` route mounted over a host that has NO server markers, so the
hydrating `outlet` claim diverges — the same recovery path handles every claim throw.

A COLD mount that throws is a genuine codegen/user-render defect (the claim asserts never run
there), so it is NOT recovered — it surfaces and stops, no reload loop. Covered below too.
*/

beforeAll(() => {
    installMiniDom()
})
/* runtimePath is a module singleton — reset so each test starts at `/`. */
beforeEach(() => {
    runtimePath.value = '/'
})

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/* A `hydratable: true` route stub, so the router treats the first paint as a HYDRATING adopt
   (`hydrating = isFirstRun && pageView.hydratable === true`). */
const hydratableRoute = (build: (host: Element) => void): Route =>
    Object.assign(
        (host: Element) => {
            build(host)
            return () => undefined
        },
        {
            build: (host: Node) => {
                build(host as Element)
            },
            hydratable: true,
        },
    )
const loader = (route: Route) => (): Promise<{ default: Route }> =>
    Promise.resolve({ default: route })

/* Capture `console.warn`/`console.error` for the span of a test. */
let warned: unknown[] = []
let errored: unknown[] = []
let originalWarn: typeof console.warn
let originalError: typeof console.error
beforeEach(() => {
    warned = []
    errored = []
    originalWarn = console.warn
    originalError = console.error
    console.warn = (...args: unknown[]) => {
        warned.push(args[0])
    }
    console.error = (...args: unknown[]) => {
        errored.push(args[0])
    }
})
afterEach(() => {
    console.warn = originalWarn
    console.error = originalError
})

describe('hydration-mismatch recovery', () => {
    test('a hydrating first-paint claim divergence recovers with a cold client render', async () => {
        const host = document.createElement('div')
        /* Empty host → no SSR outlet markers → the hydrating claim diverges on first paint. */
        let pageBuilds = 0
        const dispose = router(host, {
            '/': loader(
                hydratableRoute((target) => {
                    pageBuilds += 1
                    target.appendChild(document.createTextNode('home'))
                }),
            ),
            '*': loader(
                hydratableRoute((target) => target.appendChild(document.createTextNode('nf'))),
            ),
        })

        navigate('/')
        await flush()

        /* Recovered: the page rendered cold despite the hydrating claim throw — a live page,
           not the dead "threw while mounting" state. */
        expect(host.textContent).toBe('home')
        expect(pageBuilds).toBe(1) // the hydrating attempt threw before the page build; only the cold pass built it
        expect(warned.some((entry) => String(entry).includes('hydration mismatch'))).toBe(true)
        /* Recovery is not a crash — nothing reached the `commit` error surface. */
        expect(errored.some((entry) => String(entry).includes('threw while mounting'))).toBe(false)

        dispose()
    })

    test('a page that throws on the COLD mount too is surfaced, not recovered again (no loop)', async () => {
        const host = document.createElement('div')
        /* Always throws — the cold recovery mount throws the same way, which is a genuine defect. */
        const dispose = router(host, {
            '/': loader(
                hydratableRoute(() => {
                    throw new Error('boom in build')
                }),
            ),
            '*': loader(
                hydratableRoute((target) => target.appendChild(document.createTextNode('nf'))),
            ),
        })

        navigate('/')
        await flush()

        /* The cold retry re-threw → `commit` surfaced it and stopped. */
        expect(errored.some((entry) => String(entry).includes('threw while mounting'))).toBe(true)

        dispose()
    })
})
