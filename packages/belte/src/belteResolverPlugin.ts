// node:fs existsSync — Bun plugin onResolve is sync-only; Bun.file().exists() is async
import { existsSync, statSync } from 'node:fs'
import type { BunPlugin } from 'bun'
import { Glob } from 'bun'
import { log } from './lib/shared/log.ts'
import { pageUrlForFile } from './lib/shared/pageUrlForFile.ts'
import { extractRouteExport, rewriteForServer } from './lib/shared/rewriteRouteExports.ts'
import { routeUrlForFile } from './lib/shared/routeUrlForFile.ts'
import { writeRoutesDts } from './lib/shared/writeRoutesDts.ts'

/*
Resolves a bare directory or extensionless path to a concrete file. Mirrors
Node-style resolution (path.ts, path.js, path/index.ts, path/index.js) so
project code can use SvelteKit-style aliases like `$lib/foo/utils` that point
at directories with an index file.
*/
function resolveExtension(path: string): string {
    if (existsSync(path) && !statSync(path).isDirectory()) {
        return path
    }
    for (const extension of ['.ts', '.js', '.tsx', '.jsx']) {
        if (existsSync(`${path}${extension}`)) {
            return `${path}${extension}`
        }
    }
    for (const extension of ['ts', 'js', 'tsx', 'jsx']) {
        const indexPath = `${path}/index.${extension}`
        if (existsSync(indexPath)) {
            return indexPath
        }
    }
    return path
}

const NS = 'belte-virtual'

function escapeRegex(value: string): string {
    return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
}

/*
Bun plugin that wires every virtual import belte produces at build time:
- `belte:route`   — { routeUrl: () => import(route-module) } HTTP-verb manifest
- `belte:sockets` — { routeUrl: () => import(route-module) } SOCKET manifest
- `belte:pages`   — { pageUrl: () => import(page.svelte) } manifest
- `belte:layouts` — { dirPrefix: () => import(layout.svelte) } manifest
- `belte:app`     — { init?, handle?, handleError? } from src/app.ts
- `belte:assets`  — gzipped chunk bytes embedded for standalone compile
- `belte:shell`   — app.html content (custom or default)

Also rewrites every module under src/route to bind each verb-named export
to a runtime implementation: HTTP verbs (GET / POST / PUT / PATCH /
DELETE / HEAD) thread verb + URL into defineVerb on the server and
remoteProxy on the client; SOCKET threads just the URL into defineSocket
on the server and socketProxy on the client. Each route file is
classified once and emitted into the appropriate manifest so the server
can route HTTP requests and ws frames against disjoint URL spaces.
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
    const pagesDir = `${cwd}/src/pages`
    const routeDir = `${cwd}/src/route`
    const libDir = `${cwd}/src/lib`

    /*
    The whole-tree validation + per-leaf classification only needs to run
    once per build. Memoise the promise so the three virtual manifests
    (route/pages/layouts) share a single scan instead of each one re-globbing
    the trees. The shell read is memoised the same way so two passes don't
    re-read app.html from disk.
    */
    let pagesScanPromise: Promise<PagesScan> | undefined
    let routeScanPromise: Promise<RouteScan> | undefined
    let shellContentsPromise: Promise<string> | undefined
    function scanPagesOnce(): Promise<PagesScan> {
        if (!pagesScanPromise) {
            pagesScanPromise = scanPages(pagesDir).then(async (scan) => {
                await writeRoutesDts({ cwd, pageFiles: scan.pageFiles })
                return scan
            })
        }
        return pagesScanPromise
    }
    function scanRouteOnce(): Promise<RouteScan> {
        if (!routeScanPromise) {
            routeScanPromise = scanRoute(routeDir)
        }
        return routeScanPromise
    }
    function loadShellOnce(): Promise<string> {
        if (!shellContentsPromise) {
            shellContentsPromise = loadShell(cwd)
        }
        return shellContentsPromise
    }

    const routeFilter = new RegExp(`^${escapeRegex(routeDir)}/.*\\.ts$`)

    return {
        name: 'belte-resolver',
        setup(build) {
            build.onResolve(
                {
                    filter: /\/_virtual\/(route|sockets|pages|layouts|app|assets|shell)\.ts$/,
                },
                (args) => {
                    const name = args.path.split('/').pop()?.replace('.ts', '')
                    if (!name) {
                        return undefined
                    }
                    return { path: `belte:${name}`, namespace: NS }
                },
            )

            build.onResolve({ filter: /^\$pages(\/.*)?$/ }, (args) => {
                const subpath = args.path.slice('$pages'.length)
                return { path: resolveExtension(subpath ? `${pagesDir}${subpath}` : pagesDir) }
            })

            build.onResolve({ filter: /^\$route(\/.*)?$/ }, (args) => {
                const subpath = args.path.slice('$route'.length)
                return { path: resolveExtension(subpath ? `${routeDir}${subpath}` : routeDir) }
            })

            build.onResolve({ filter: /^\$lib(\/.*)?$/ }, (args) => {
                const subpath = args.path.slice('$lib'.length)
                return { path: resolveExtension(subpath ? `${libDir}${subpath}` : libDir) }
            })

            build.onLoad({ filter: routeFilter }, async (args) => {
                if (!args.path.startsWith(`${routeDir}/`)) {
                    return undefined
                }
                const relativePath = args.path.slice(routeDir.length + 1)
                const source = await Bun.file(args.path).text()
                const url = routeUrlForFile(relativePath)
                const declared = extractRouteExport(source)
                if (!declared) {
                    throw new Error(
                        `[belte] src/route/${relativePath} has no \`export const <name> = <VERB>(...)\` — every $route module must declare exactly one remote function`,
                    )
                }
                const expectedName = relativePath.replace(/\.ts$/, '').split('/').pop() ?? ''
                if (declared.exportName !== expectedName) {
                    throw new Error(
                        `[belte] src/route/${relativePath} exports \`${declared.exportName}\` but the filename expects \`${expectedName}\` — the export name must match the file's stem`,
                    )
                }
                /*
                For the client bundle, replace the entire module source
                with a single proxy stub so the handler body and any
                server-only top-level imports never reach the browser. The
                stub keeps the same export name the source declared, so
                page imports resolve identically on both sides. SOCKET
                modules emit a socketProxy stub against the route URL; HTTP
                verbs emit a remoteProxy stub against verb + URL.
                */
                if (target === 'client') {
                    const contents =
                        declared.verb === 'SOCKET'
                            ? `import { socketProxy as __belteSocketProxy__ } from 'belte/client/socketProxy';
export const ${declared.exportName} = __belteSocketProxy__(${JSON.stringify(url)});
`
                            : `import { remoteProxy as __belteRemoteProxy__ } from 'belte/client/remoteProxy';
export const ${declared.exportName} = __belteRemoteProxy__(${JSON.stringify(declared.verb)}, ${JSON.stringify(url)});
`
                    return { contents, loader: 'ts' }
                }
                /*
                Server target: strip the user's verb import, then rewrite
                the `<VERB>(...)` call so the verb (from the identifier)
                and the URL (from the file path) are threaded into the
                runtime constructor — defineVerb for HTTP verbs,
                defineSocket for SOCKET. The user's handler body stays
                intact between the parens; any generics on the call are
                dropped (they carry no runtime info). Rewriting is
                tokenizer-driven so `GET` mentions inside strings and
                comments are left alone.
                */
                const rewritten = rewriteForServer(source, url)
                const banner =
                    declared.verb === 'SOCKET'
                        ? `import { defineSocket as __belteDefineSocket__ } from 'belte/server/defineSocket';
`
                        : `import { defineVerb as __belteDefineVerb__ } from 'belte/server/defineVerb';
`
                return { contents: `${banner}${rewritten}`, loader: 'ts' }
            })

            build.onLoad({ filter: /.*/, namespace: NS }, async (args) => {
                if (args.path === 'belte:route') {
                    const { httpFiles } = await scanRouteOnce()
                    const byUrl = httpFiles
                        .toSorted()
                        .map((file) => ({ url: routeUrlForFile(file), file }))
                    const entries = byUrl
                        .map(
                            ({ url, file }) =>
                                `    ${JSON.stringify(url)}: () => import(${JSON.stringify(`${routeDir}/${file}`)}),`,
                        )
                        .join('\n')
                    if (byUrl.length > 0) {
                        log.info(
                            `resolved ${byUrl.length} route modules: ${byUrl.map((b) => b.url).join(', ')}`,
                        )
                    }
                    return {
                        contents: `export const route = {\n${entries}\n}\n`,
                        loader: 'js',
                    }
                }

                if (args.path === 'belte:sockets') {
                    const { socketFiles } = await scanRouteOnce()
                    const byUrl = socketFiles
                        .toSorted()
                        .map((file) => ({ url: routeUrlForFile(file), file }))
                    const entries = byUrl
                        .map(
                            ({ url, file }) =>
                                `    ${JSON.stringify(url)}: () => import(${JSON.stringify(`${routeDir}/${file}`)}),`,
                        )
                        .join('\n')
                    if (byUrl.length > 0) {
                        log.info(
                            `resolved ${byUrl.length} socket modules: ${byUrl.map((b) => b.url).join(', ')}`,
                        )
                    }
                    return {
                        contents: `export const sockets = {\n${entries}\n}\n`,
                        loader: 'js',
                    }
                }

                if (args.path === 'belte:pages') {
                    const { pageFiles: files } = await scanPagesOnce()
                    const byUrl = files
                        .toSorted()
                        .map((file) => ({ url: pageUrlForFile(file), file }))
                    const entries = byUrl
                        .map(
                            ({ url, file }) =>
                                `    ${JSON.stringify(url)}: () => import(${JSON.stringify(`${pagesDir}/${file}`)}),`,
                        )
                        .join('\n')
                    log.info(
                        `resolved ${byUrl.length} pages: ${byUrl.map((b) => b.url).join(', ')}`,
                    )
                    return {
                        contents: `export const pages = {\n${entries}\n}\n`,
                        loader: 'js',
                    }
                }

                if (args.path === 'belte:layouts') {
                    const { layoutFiles: files } = await scanPagesOnce()
                    const byPrefix = files
                        .toSorted()
                        .map((file) => ({ prefix: pageUrlForFile(file), file }))
                    const entries = byPrefix
                        .map(
                            ({ prefix, file }) =>
                                `    ${JSON.stringify(prefix)}: () => import(${JSON.stringify(`${pagesDir}/${file}`)}),`,
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
                    if (await Bun.file(userApp).exists()) {
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
                    const content = await loadShellOnce()
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

type PagesScan = {
    pageFiles: string[]
    layoutFiles: string[]
}

/*
Walks src/pages once and partitions every `.svelte` file into pages and
layouts. Rejects any other file shape — pages and layouts must live in
their own folders (or directly under `src/pages/` for the root) and the
basename must be `page.svelte` or `layout.svelte`. A misnamed file (e.g.
`about.svelte`) would otherwise be silently ignored; the explicit error
gives the right hint.
*/
async function scanPages(pagesDir: string): Promise<PagesScan> {
    if (!existsSync(pagesDir)) {
        return { pageFiles: [], layoutFiles: [] }
    }
    const allFiles = await Array.fromAsync(new Glob('**/*.svelte').scan({ cwd: pagesDir }))
    const pageFiles: string[] = []
    const layoutFiles: string[] = []
    for (const file of allFiles) {
        const basename = file.split('/').pop() ?? ''
        if (basename === 'page.svelte') {
            pageFiles.push(file)
            continue
        }
        if (basename === 'layout.svelte') {
            layoutFiles.push(file)
            continue
        }
        const stem = basename.replace(/\.[^.]+$/, '')
        const parent = file.includes('/') ? `${file.slice(0, file.lastIndexOf('/'))}/` : ''
        throw new Error(
            `[belte] src/pages/${file} is not a recognized page file — every page must live in its own folder as page.svelte or layout.svelte (try src/pages/${parent}${stem}/page.svelte)`,
        )
    }
    return { pageFiles, layoutFiles }
}

/*
Walks src/route once and partitions every `.ts` file into HTTP-verb routes
and SOCKET routes. Classification reads each file's source and extracts
the verb identifier (cheap — one tokenizer pass per file). Returns
empty lists when the directory doesn't exist so a pages-only app
builds without a `route/` folder.
*/
async function scanRoute(routeDir: string): Promise<RouteScan> {
    if (!existsSync(routeDir)) {
        return { httpFiles: [], socketFiles: [] }
    }
    const allFiles = await Array.fromAsync(new Glob('**/*.ts').scan({ cwd: routeDir }))
    const httpFiles: string[] = []
    const socketFiles: string[] = []
    await Promise.all(
        allFiles.map(async (file) => {
            const source = await Bun.file(`${routeDir}/${file}`).text()
            const declared = extractRouteExport(source)
            if (declared?.verb === 'SOCKET') {
                socketFiles.push(file)
            } else {
                httpFiles.push(file)
            }
        }),
    )
    return { httpFiles, socketFiles }
}

type RouteScan = {
    httpFiles: string[]
    socketFiles: string[]
}

/*
Picks `src/app.html` when it exists, otherwise the bundled default shell.
Reads the file once per build so the resolver's two virtual passes share a
single disk hit. Rewrites the literal `/_app/client.js` and `/_app/client.css`
references to the hashed entry filenames emitted by the client build so the
entry bundles can be served with `immutable` cache headers like the chunks.
*/
async function loadShell(cwd: string): Promise<string> {
    const userShell = `${cwd}/src/app.html`
    const defaultShell = new URL('./assets/app.html', import.meta.url).pathname
    const filepath = (await Bun.file(userShell).exists()) ? userShell : defaultShell
    if (filepath === userShell) {
        log.info('using custom src/app.html')
    }
    const content = await Bun.file(filepath).text()
    return await rewriteHashedClientEntries(content, cwd)
}

/*
Scans `dist/_app/` for the hashed client entry filenames produced by
build.ts (e.g. `client-abc12345.js`, `client-abc12345.css`) and swaps the
shell's literal `/_app/client.js` and `/_app/client.css` references for
them. When the directory is missing (someone running the server before a
build) the shell is returned unchanged so the existing broken-asset
behaviour is preserved.
*/
async function rewriteHashedClientEntries(shell: string, cwd: string): Promise<string> {
    const appDir = `${cwd}/dist/_app`
    if (!existsSync(appDir)) {
        return shell
    }
    const entries = await Array.fromAsync(
        new Glob('client-*').scan({ cwd: appDir, onlyFiles: true }),
    )
    const jsEntry = entries.find((file) => /^client-[a-z0-9]+\.js$/i.test(file))
    const cssEntry = entries.find((file) => /^client-[a-z0-9]+\.css$/i.test(file))
    let result = shell
    if (jsEntry) {
        result = result.replace('/_app/client.js', `/_app/${jsEntry}`)
    }
    if (cssEntry) {
        result = result.replace('/_app/client.css', `/_app/${cssEntry}`)
    }
    return result
}
