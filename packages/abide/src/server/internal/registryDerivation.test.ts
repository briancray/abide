import { describe, expect, test } from 'bun:test'
import { GET } from '../GET.ts'
import type { AppConfig } from './appConfig.ts'
import { defaultAgentSurface, provideDefaultAgentSurface } from './defaultAgentSurface.ts'
import { matchNavRoute } from './navRoute.ts'
import { registeredDerivationCount } from './registryDerivation.ts'
import { createApp } from './router.ts'

// A DERIVED-FROM-THE-REGISTRY value is stale in the dev lane and nowhere else, which is the hardest place
// to notice it: the symptom is a 404 for a page that exists, or a tool list one build behind, with
// nothing wrong at the point of failure. These assert the re-derivation directly rather than through the
// dev watcher, which has no seam — see `serve.ts`'s `startWatch`.
//
// Each of the first three FAILS on the code as it stood before `registryDerivation.ts`: the page-pattern
// list and the agent surface had no invalidation at all, and the client bundle's was a hand-called hook
// in `cli/`. Verified by reverting each registration in turn.

function scopeFor(pathname: string): { route: { url: URL; name: string; params: unknown } } {
    return {
        route: { url: new URL(`http://localhost${pathname}`), name: '', params: {} },
    }
}

describe('derived-from-the-registry re-derives on rebind', () => {
    test('a page added after boot is matched once the app rebinds', () => {
        const config: AppConfig = { pages: { '/': 'home.abide' } }
        const app = createApp(config)
        try {
            // Prime the derivation — this is what made the bug latent rather than immediate: an app whose
            // pattern list was never asked for before the reload had nothing stale to serve.
            // biome-ignore lint/suspicious/noExplicitAny: RequestScope is request-shaped; the match reads only `route`.
            expect(matchNavRoute(scopeFor('/') as any, config)?.pattern).toBe('/')
            // biome-ignore lint/suspicious/noExplicitAny: as above.
            expect(matchNavRoute(scopeFor('/about') as any, config)).toBeUndefined()

            // What `abide dev`'s rebuild does: reassign the property on the SAME config object, so a
            // WeakMap keyed on that object keeps answering with the boot's pages.
            config.pages = { '/': 'home.abide', '/about': 'about.abide' }
            app.rebind()

            // biome-ignore lint/suspicious/noExplicitAny: as above.
            const scope = scopeFor('/about') as any
            expect(matchNavRoute(scope, config)?.pattern).toBe('/about')
        } finally {
            void app.stop()
        }
    })

    test('a page deleted after boot stops matching once the app rebinds', () => {
        // The other half, and the worse one: a stale pattern still MATCHES, so dispatch claims the nav
        // route and then throws on the branch `handleNavRoute` labels "Unreachable".
        const config: AppConfig = { pages: { '/': 'home.abide', '/gone': 'gone.abide' } }
        const app = createApp(config)
        try {
            // biome-ignore lint/suspicious/noExplicitAny: as above.
            expect(matchNavRoute(scopeFor('/gone') as any, config)?.pattern).toBe('/gone')
            config.pages = { '/': 'home.abide' }
            app.rebind()
            // biome-ignore lint/suspicious/noExplicitAny: as above.
            expect(matchNavRoute(scopeFor('/gone') as any, config)).toBeUndefined()
        } finally {
            void app.stop()
        }
    })

    test("the agent tool surface reflects the rebound registry, not the first build's", () => {
        const config: AppConfig = { routes: {} }
        const app = createApp(config)
        // The router installs its own provider at boot; this one stands in for `rpcTools(config, origin)`
        // without the HTTP projection, and closes over the live config exactly as that one does. Passing
        // `config` is what SCOPES the invalidation to this app — without it another test file's rebind
        // would drop this surface, which is the cross-file flake the scoping exists to prevent.
        const withdraw = provideDefaultAgentSurface(
            () =>
                Object.keys(config.routes ?? {}).map((name) => ({
                    name,
                    description: '',
                    inputSchema: {},
                    run: async () => ({}),
                })),
            config,
        )
        try {
            expect(defaultAgentSurface().map((tool) => tool.name)).toEqual([])

            config.routes = { greet: GET(() => ({ ok: true })) as never }
            app.rebind()

            expect(defaultAgentSurface().map((tool) => tool.name)).toEqual(['greet'])
        } finally {
            withdraw()
            void app.stop()
        }
    })

    test('every derivation this module knows about is registered', () => {
        // Three registrations, named in `registryDerivation.ts`'s header: the page-pattern list
        // (`navRoute`), the client bundle (`clientBundle`), the agent tool surface
        // (`defaultAgentSurface`). This is a COUNT rather than a set because the invalidators are
        // closures with no identity worth asserting — the point is that adding a fourth config-keyed
        // cache lands here, where the header enumerating them is one line away.
        //
        // If this fails after you added a cache: register it, add it to the header, bump the number.
        // If it fails after you REMOVED one, the same. It is a tripwire, not a contract.
        expect(registeredDerivationCount()).toBe(3)
    })
})
