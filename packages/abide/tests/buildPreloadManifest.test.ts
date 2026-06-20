import { afterAll, describe, expect, test } from 'bun:test'
import { buildPreloadManifest } from '../src/lib/server/runtime/buildPreloadManifest.ts'

/* A synthetic built `_app`: the entry's compiled pages/layouts manifest (route → lazy
   chunk) plus the entry's own static runtime imports, and each route/layout chunk's
   static imports — exactly what buildPreloadManifest parses out of a real Bun build. */
const distDir = `/tmp/abide-preload-${Bun.hash('preload-fixture').toString(36)}`
const appDir = `${distDir}/_app`

const files: Record<string, string> = {
    // Entry: shared runtime (shell preloads these) + dynamic route/layout imports.
    'client-aaaaaaaa.js': `
        import { mount } from "./clientEntry-shared1.js";
        import { hydrate } from "./clientEntry-shared2.js";
        var pages = {
            "/": () => import("./page-home0000.js"),
            "/auth/login": () => import("./page-login000.js"),
        };
        var layouts = {
            "/": () => import("./layout-root000.js"),
            "/auth": () => import("./layout-auth000.js"),
        };
    `,
    // Shared runtime chunks (in the entry's closure — must be excluded from route sets).
    'clientEntry-shared1.js': `export const mount = 1;`,
    'clientEntry-shared2.js': `import { x } from "./clientEntry-shared3.js"; export const hydrate = x;`,
    'clientEntry-shared3.js': `export const x = 1;`,
    // Route-only runtime: only reachable through page/layout chunks, never the entry.
    'page-home0000.js': `import { only } from "./clientEntry-only1.js"; export default only;`,
    'clientEntry-only1.js': `import { y } from "./clientEntry-only2.js"; export const only = y;`,
    'clientEntry-only2.js': `export const y = 2;`,
    'page-login000.js': `import { mount } from "./clientEntry-shared1.js"; export default mount;`,
    'layout-root000.js': `import { r } from "./clientEntry-rootlay.js"; export default r;`,
    'clientEntry-rootlay.js': `export const r = 3;`,
    'layout-auth000.js': `import { a } from "./clientEntry-authlay.js"; export default a;`,
    'clientEntry-authlay.js': `export const a = 4;`,
}

await Promise.all(
    Object.entries(files).map(([name, source]) => Bun.write(`${appDir}/${name}`, source)),
)

afterAll(async () => {
    await Bun.$`rm -rf ${distDir}`.quiet().nothrow()
})

describe('buildPreloadManifest', () => {
    test('maps each route to its page + layout-chain chunks and route-only runtime, excluding the entry graph', async () => {
        const manifest = await buildPreloadManifest({ distDir })

        /* "/" → its page chunk + the root layout chunk + their route-only runtime deps.
           The entry's shared runtime (clientEntry-shared{1,2,3}) is excluded. */
        expect(new Set(manifest['/'])).toEqual(
            new Set([
                'page-home0000.js',
                'clientEntry-only1.js',
                'clientEntry-only2.js',
                'layout-root000.js',
                'clientEntry-rootlay.js',
            ]),
        )

        /* "/auth/login" → page + BOTH layouts in the chain (root then /auth). The page
           imports only shared runtime, so beyond the chunks themselves nothing extra. */
        expect(new Set(manifest['/auth/login'])).toEqual(
            new Set([
                'page-login000.js',
                'layout-root000.js',
                'clientEntry-rootlay.js',
                'layout-auth000.js',
                'clientEntry-authlay.js',
            ]),
        )

        /* The entry's own static graph never appears in any route set. */
        const everyChunk = Object.values(manifest).flat()
        for (const shared of [
            'clientEntry-shared1.js',
            'clientEntry-shared2.js',
            'clientEntry-shared3.js',
        ]) {
            expect(everyChunk).not.toContain(shared)
        }
    })

    test('reads the embedded gzip asset map (standalone compile) identically to disk', async () => {
        /* Mirror the compile-time embed: each `_app/<file>` keyed by request path, gzip bytes. */
        const assets = Object.fromEntries(
            Object.entries(files).map(([name, source]) => [
                `/_app/${name}`,
                Bun.gzipSync(new TextEncoder().encode(source)),
            ]),
        ) as Record<string, Uint8Array<ArrayBuffer>>

        const fromAssets = await buildPreloadManifest({ distDir: '/tmp/unused', assets })
        const fromDisk = await buildPreloadManifest({ distDir })
        expect(fromAssets).toEqual(fromDisk)
    })

    test('returns an empty map when the build tree is absent', async () => {
        expect(await buildPreloadManifest({ distDir: '/tmp/abide-preload-missing-xyz' })).toEqual(
            {},
        )
    })
})
