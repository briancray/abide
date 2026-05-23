// node:fs existsSync — Bun plugin onResolve is sync-only; Bun.file().exists() is async
import { existsSync } from 'node:fs'
import type { BunPlugin } from 'bun'
import { Glob } from 'bun'
import { log } from './lib/shared/log.ts'
import { routeForFile } from './lib/shared/routeForFile.ts'

const NS = 'belte-virtual'

const VERB_IMPORT_RE =
    /^\s*import\s*\{[^}]*\}\s*from\s*['"]belte\/route\/(GET|POST|PUT|PATCH|DELETE)['"]\s*;?\s*$/gm

const ROUTE_LEAF_NAMES = new Set(['page.svelte', 'layout.svelte', 'endpoint.ts'])

/*
Bun plugin that wires every virtual import belte produces at build time:
- `belte:remotes`  — { routeUrl: () => import(endpoint.ts module) } manifest
- `belte:pages`    — { routeUrl: () => import(page.svelte) } manifest
- `belte:layouts`  — { dirPrefix: () => import(layout.svelte) } manifest
- `belte:app`      — { init?, handle?, handleError?, socket? } from src/app.ts
- `belte:assets`   — gzipped chunk bytes embedded for standalone compile
- `belte:shell`    — app.html content (custom or default)

Also rewrites every `endpoint.ts` file inside src/routes to substitute the
imported verb helpers with route-bound versions: server target uses defineVerb
so handlers are invoked in-process; browser target uses remoteProxy so handler
bodies are dropped and call sites become network fetches.
*/
export function belteResolverPlugin({
    cwd = process.cwd(),
    embedAssets = false,
    target = 'server',
}: {
    cwd?: string
    embedAssets?: boolean
    target?: 'server' | 'client'
} = {}): BunPlugin {
    const routesDir = `${cwd}/src/routes`
    const libDir = `${cwd}/src/lib`

    return {
        name: 'belte-resolver',
        setup(build) {
            build.onResolve(
                {
                    filter: /\/_virtual\/(remotes|pages|layouts|app|assets|shell)\.ts$/,
                },
                (args) => {
                    const name = args.path.split('/').pop()?.replace('.ts', '')
                    if (!name) {
                        return undefined
                    }
                    return { path: `belte:${name}`, namespace: NS }
                },
            )

            build.onResolve({ filter: /^\$routes(\/.*)?$/ }, (args) => {
                const subpath = args.path.slice('$routes'.length)
                return { path: subpath ? `${routesDir}${subpath}` : routesDir }
            })

            build.onResolve({ filter: /^\$lib(\/.*)?$/ }, (args) => {
                const subpath = args.path.slice('$lib'.length)
                return { path: subpath ? `${libDir}${subpath}` : libDir }
            })

            build.onLoad({ filter: /\/endpoint\.ts$/ }, async (args) => {
                if (!args.path.startsWith(routesDir)) {
                    return undefined
                }
                const source = await Bun.file(args.path).text()
                const relativePath = args.path.slice(routesDir.length + 1)
                const routeUrl = routeForFile(relativePath)
                const stripped = source.replace(VERB_IMPORT_RE, '')
                const banner = renderVerbBindings(routeUrl, target)
                return { contents: `${banner}\n${stripped}`, loader: 'ts' }
            })

            build.onLoad({ filter: /.*/, namespace: NS }, async (args) => {
                if (args.path === 'belte:remotes') {
                    const files = await scanRoutes(routesDir, '**/endpoint.ts')
                    const byRoute = Map.groupBy(files, (file) => routeForFile(file))
                    const entries = Array.from(byRoute.entries())
                        .toSorted(([a], [b]) => a.localeCompare(b))
                        .map(([routeUrl, group]) => {
                            const filePath = group[0]
                            const absolutePath = `${routesDir}/${filePath}`
                            return `    ${JSON.stringify(routeUrl)}: () => import(${JSON.stringify(absolutePath)}),`
                        })
                        .join('\n')
                    if (byRoute.size > 0) {
                        log.info(
                            `resolved ${byRoute.size} endpoints: ${Array.from(byRoute.keys()).join(', ')}`,
                        )
                    }
                    return {
                        contents: `export const remotes = {\n${entries}\n}\n`,
                        loader: 'js',
                    }
                }

                if (args.path === 'belte:pages') {
                    const files = await scanRoutes(routesDir, '**/page.svelte')
                    const byRoute = files
                        .toSorted()
                        .map((file) => ({ route: routeForFile(file), file }))
                    const entries = byRoute
                        .map(
                            ({ route, file }) =>
                                `    ${JSON.stringify(route)}: () => import(${JSON.stringify(`${routesDir}/${file}`)}),`,
                        )
                        .join('\n')
                    log.info(
                        `resolved ${byRoute.length} pages: ${byRoute.map((b) => b.route).join(', ')}`,
                    )
                    return {
                        contents: `export const pages = {\n${entries}\n}\n`,
                        loader: 'js',
                    }
                }

                if (args.path === 'belte:layouts') {
                    const files = await scanRoutes(routesDir, '**/layout.svelte')
                    const byPrefix = files
                        .toSorted()
                        .map((file) => ({ prefix: routeForFile(file), file }))
                    const entries = byPrefix
                        .map(
                            ({ prefix, file }) =>
                                `    ${JSON.stringify(prefix)}: () => import(${JSON.stringify(`${routesDir}/${file}`)}),`,
                        )
                        .join('\n')
                    if (byPrefix.length > 0) {
                        log.info(
                            `resolved ${byPrefix.length} layouts: ${byPrefix.map((b) => b.prefix).join(', ')}`,
                        )
                    }
                    return {
                        contents: `export const layouts = {\n${entries}\n}\n`,
                        loader: 'js',
                    }
                }

                if (args.path === 'belte:app') {
                    const userApp = `${cwd}/src/app.ts`
                    if (existsSync(userApp)) {
                        log.info('using custom src/app.ts')
                        return {
                            contents: `export * from ${JSON.stringify(userApp)}`,
                            loader: 'js',
                        }
                    }
                    return { contents: 'export {};', loader: 'js' }
                }

                if (args.path === 'belte:assets') {
                    if (!embedAssets) {
                        return { contents: 'export const assets = undefined', loader: 'js' }
                    }
                    const appDir = `${cwd}/dist/_app`
                    const files = await Array.fromAsync(
                        new Glob('**/*.gz').scan({ cwd: appDir, onlyFiles: true }),
                    )
                    const encoded = await Promise.all(
                        files.map(async (file) => {
                            const bytes = await Bun.file(`${appDir}/${file}`).bytes()
                            const urlPath = `/_app/${file.replace(/\.gz$/, '')}`
                            return {
                                line: `    ${JSON.stringify(urlPath)}: _d(${JSON.stringify(bytes.toBase64())}),`,
                                bytes: bytes.byteLength,
                            }
                        }),
                    )
                    const entries = encoded.map((entry) => entry.line)
                    const totalBytes = encoded.reduce((total, entry) => total + entry.bytes, 0)
                    log.info(
                        `embedded ${encoded.length} gzipped assets from dist/_app/ (${(totalBytes / 1024).toFixed(1)} KiB)`,
                    )
                    return {
                        contents: `const _d = (s) => Uint8Array.fromBase64(s)
export const assets = {
${entries.join('\n')}
}
`,
                        loader: 'js',
                    }
                }

                if (args.path === 'belte:shell') {
                    const userShell = `${cwd}/src/app.html`
                    const defaultShell = new URL('./assets/app.html', import.meta.url).pathname
                    const filepath = (await Bun.file(userShell).exists()) ? userShell : defaultShell
                    const content = await Bun.file(filepath).text()
                    if (filepath === userShell) {
                        log.info('using custom src/app.html')
                    }
                    return {
                        contents: `export const shell = ${JSON.stringify(content)}`,
                        loader: 'js',
                    }
                }

                return undefined
            })
        },
    }
}

/*
Globs the routes directory for a specific leaf name and rejects any
`.svelte`/`.ts` sibling whose basename isn't a recognized leaf
(page.svelte / layout.svelte / endpoint.ts). Each route must live in its own
folder; the only files allowed directly under src/routes are the three
leaves, which map to `/`. A misnamed file (e.g. `about.svelte`) would
otherwise be silently ignored — the explicit error gives the right hint.
*/
async function scanRoutes(routesDir: string, pattern: string): Promise<string[]> {
    const [files, allFiles] = await Promise.all([
        Array.fromAsync(new Glob(pattern).scan({ cwd: routesDir })),
        Array.fromAsync(new Glob('**/*.{svelte,ts}').scan({ cwd: routesDir })),
    ])
    for (const file of allFiles) {
        const basename = file.split('/').pop() ?? ''
        if (!ROUTE_LEAF_NAMES.has(basename)) {
            const stem = basename.replace(/\.[^.]+$/, '')
            const leaf = basename.endsWith('.svelte') ? 'page.svelte' : 'endpoint.ts'
            const parent = file.includes('/') ? `${file.slice(0, file.lastIndexOf('/'))}/` : ''
            throw new Error(
                `[belte] src/routes/${file} is not a recognized route file — every route must live in its own folder as page.svelte, layout.svelte, or endpoint.ts (try src/routes/${parent}${stem}/${leaf})`,
            )
        }
    }
    return files
}

/*
Emits the verb bindings prepended to an endpoint.ts module after the user's
`import { VERB } from 'belte/route/VERB'` statements are stripped. Server
target wires defineVerb (real handler invocation); browser target wires
remoteProxy (drop handler body, network fetch).
*/
function renderVerbBindings(routeUrl: string, target: 'server' | 'client'): string {
    if (target === 'server') {
        return `import { defineVerb as __belteDefineVerb__ } from 'belte/server/defineVerb';
const GET = (handler) => __belteDefineVerb__('GET', ${JSON.stringify(routeUrl)}, handler);
const POST = (handler) => __belteDefineVerb__('POST', ${JSON.stringify(routeUrl)}, handler);
const PUT = (handler) => __belteDefineVerb__('PUT', ${JSON.stringify(routeUrl)}, handler);
const PATCH = (handler) => __belteDefineVerb__('PATCH', ${JSON.stringify(routeUrl)}, handler);
const DELETE = (handler) => __belteDefineVerb__('DELETE', ${JSON.stringify(routeUrl)}, handler);
`
    }
    return `import { remoteProxy as __belteRemoteProxy__ } from 'belte/client/remoteProxy';
import { remoteNotHydrated as __belteNotHydrated__ } from 'belte/client/remoteNotHydrated';
const __belteVerb__ = (verb) => (_handler, options) =>
    options && options.hydrate === false
        ? __belteNotHydrated__(\`\${verb} ${routeUrl}\`)
        : __belteRemoteProxy__(verb, ${JSON.stringify(routeUrl)});
const GET = __belteVerb__('GET');
const POST = __belteVerb__('POST');
const PUT = __belteVerb__('PUT');
const PATCH = __belteVerb__('PATCH');
const DELETE = __belteVerb__('DELETE');
`
}
