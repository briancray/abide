// node:fs existsSync — Bun plugin onResolve is sync-only; Bun.file().exists() is async
import { existsSync, statSync } from 'node:fs'
import type { BunPlugin } from 'bun'
import { Glob } from 'bun'
import { log } from './lib/shared/log.ts'
import { pageUrlForFile } from './lib/shared/pageUrlForFile.ts'
import { preparePromptModule } from './lib/shared/preparePromptModule.ts'
import { prepareRpcModule } from './lib/shared/prepareRpcModule.ts'
import { prepareSocketModule } from './lib/shared/prepareSocketModule.ts'
import { programNameForPackage } from './lib/shared/programNameForPackage.ts'
import { promptNameForFile } from './lib/shared/promptNameForFile.ts'
import { rpcUrlForFile } from './lib/shared/rpcUrlForFile.ts'
import { socketNameForFile } from './lib/shared/socketNameForFile.ts'
import { writeRoutesDts } from './lib/shared/writeRoutesDts.ts'

/*
Resolves a bare directory or extensionless path to a concrete file. Mirrors
Node-style resolution (path.ts, path.js, path/index.ts, path/index.js) so
project code can use SvelteKit-style aliases like `$shared/foo/utils` that point
at directories with an index file. The (path → resolved) mapping is
deterministic per build, so cache it — every module that imports a `$shared`
alias hits this twice or more, and each call would otherwise do up to nine
filesystem stats.
*/
const resolveExtensionCache = new Map<string, string>()
function resolveExtension(path: string): string {
    const cached = resolveExtensionCache.get(path)
    if (cached !== undefined) {
        return cached
    }
    const resolved = resolveExtensionUncached(path)
    resolveExtensionCache.set(path, resolved)
    return resolved
}

function resolveExtensionUncached(path: string): string {
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
- `belte:rpc`     — { rpcUrl: () => import(rpc-module) } HTTP-verb manifest
- `belte:sockets` — { socketName: () => import(socket-module) } socket manifest
- `belte:pages`   — { pageUrl: () => import(page.svelte) } manifest
- `belte:layouts` — { dirPrefix: () => import(layout.svelte) } manifest
- `belte:prompts` — { promptName: () => import(prompt-module) } manifest
- `belte:app`     — { init?, handle?, handleError? } from src/app.ts
- `belte:assets`  — zstd-compressed chunk bytes embedded for standalone compile
- `belte:public-assets`  — zstd-embedded src/browser/public files
- `belte:mcp-resources`  — zstd-embedded src/mcp/resources files
- `belte:shell`   — app.html content (custom or default)

Also rewrites modules under src/server/rpc and src/server/sockets:
- src/server/rpc/<file>.ts: each HTTP-verb export is bound to a runtime
  implementation — defineVerb on the server, remoteProxy on the client.
- src/server/sockets/<file>.ts: each `socket(opts)` export is bound to
  defineSocket on the server (with the socket name + opts) or
  socketProxy on the client (name only — opts are server-side).
*/
export function belteResolverPlugin({
    cwd = process.cwd(),
    embedAssets = false,
    target = 'server',
    thin,
}: {
    cwd?: string
    embedAssets?: boolean
    target?: 'server' | 'client'
    thin?: boolean
} = {}): BunPlugin {
    const serverDir = `${cwd}/src/server`
    const browserDir = `${cwd}/src/browser`
    const sharedDir = `${cwd}/src/shared`
    const mcpDir = `${cwd}/src/mcp`
    const cliDir = `${cwd}/src/cli`
    const rpcDir = `${serverDir}/rpc`
    const socketsDir = `${serverDir}/sockets`
    const pagesDir = `${browserDir}/pages`
    const publicDir = `${browserDir}/public`
    const promptsDir = `${mcpDir}/prompts`
    const resourcesDir = `${mcpDir}/resources`

    /*
    The whole-tree validation + per-leaf classification only needs to run
    once per build. Memoise the promise so the virtual manifests
    (rpc/sockets/pages/layouts) share a single scan instead of each one
    re-globbing the trees. The shell read is memoised the same way so two
    passes don't re-read app.html from disk.
    */
    let pagesScanPromise: Promise<PagesScan> | undefined
    let rpcScanPromise: Promise<string[]> | undefined
    let socketsScanPromise: Promise<string[]> | undefined
    let promptsScanPromise: Promise<string[]> | undefined
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
    function scanRpcOnce(): Promise<string[]> {
        if (!rpcScanPromise) {
            rpcScanPromise = scanRpc(rpcDir)
        }
        return rpcScanPromise
    }
    function scanSocketsOnce(): Promise<string[]> {
        if (!socketsScanPromise) {
            socketsScanPromise = scanSockets(socketsDir)
        }
        return socketsScanPromise
    }
    function scanPromptsOnce(): Promise<string[]> {
        if (!promptsScanPromise) {
            promptsScanPromise = scanPrompts(promptsDir)
        }
        return promptsScanPromise
    }
    function loadShellOnce(): Promise<string> {
        if (!shellContentsPromise) {
            shellContentsPromise = loadShell(cwd)
        }
        return shellContentsPromise
    }

    const rpcFilter = new RegExp(`^${escapeRegex(rpcDir)}/.*\\.ts$`)
    const socketsFilter = new RegExp(`^${escapeRegex(socketsDir)}/.*\\.ts$`)
    const promptsFilter = new RegExp(`^${escapeRegex(promptsDir)}/.*\\.ts$`)

    return {
        name: 'belte-resolver',
        setup(build) {
            build.onResolve(
                {
                    filter: /\/_virtual\/(rpc|sockets|prompts|pages|layouts|app|mcp-resources|mcp|assets|public-assets|shell|app-info|cli-manifest|cli-name|cli-chrome|cli-rpcs)\.ts$/,
                },
                (args) => {
                    const name = args.path.split('/').pop()?.replace('.ts', '')
                    if (!name) {
                        return undefined
                    }
                    return { path: `belte:${name}`, namespace: NS }
                },
            )

            /*
            User-facing aliases are the five top-level project directories.
            Sub-paths fall out of them: `$server/rpc/getThing`,
            `$browser/pages/...`, `$mcp/prompts/...`, `$mcp/resources/...`.
            `lib/` is userland — projects declare their own lib aliases.
            */
            build.onResolve({ filter: /^\$server(\/.*)?$/ }, (args) => {
                const subpath = args.path.slice('$server'.length)
                return { path: resolveExtension(subpath ? `${serverDir}${subpath}` : serverDir) }
            })

            build.onResolve({ filter: /^\$browser(\/.*)?$/ }, (args) => {
                const subpath = args.path.slice('$browser'.length)
                return { path: resolveExtension(subpath ? `${browserDir}${subpath}` : browserDir) }
            })

            build.onResolve({ filter: /^\$shared(\/.*)?$/ }, (args) => {
                const subpath = args.path.slice('$shared'.length)
                return { path: resolveExtension(subpath ? `${sharedDir}${subpath}` : sharedDir) }
            })

            build.onResolve({ filter: /^\$mcp(\/.*)?$/ }, (args) => {
                const subpath = args.path.slice('$mcp'.length)
                return { path: resolveExtension(subpath ? `${mcpDir}${subpath}` : mcpDir) }
            })

            build.onResolve({ filter: /^\$cli(\/.*)?$/ }, (args) => {
                const subpath = args.path.slice('$cli'.length)
                return { path: resolveExtension(subpath ? `${cliDir}${subpath}` : cliDir) }
            })

            build.onLoad({ filter: rpcFilter }, async (args) => {
                if (!args.path.startsWith(`${rpcDir}/`)) {
                    return undefined
                }
                const relativePath = args.path.slice(rpcDir.length + 1)
                const source = await Bun.file(args.path).text()
                const url = rpcUrlForFile(relativePath)
                const prepared = prepareRpcModule(source)
                if (!prepared) {
                    throw new Error(
                        `[belte] src/server/rpc/${relativePath} has no \`export const <name> = <VERB>(...)\` — every $rpc module must declare exactly one remote function`,
                    )
                }
                const expectedName = relativePath.replace(/\.ts$/, '').split('/').pop() ?? ''
                if (prepared.exportName !== expectedName) {
                    throw new Error(
                        `[belte] src/server/rpc/${relativePath} exports \`${prepared.exportName}\` but the filename expects \`${expectedName}\` — the export name must match the file's stem`,
                    )
                }
                /*
                For the client bundle, replace the entire module source
                with a single proxy stub so the handler body and any
                server-only top-level imports never reach the browser.
                The stub keeps the same export name the source declared,
                so page imports resolve identically on both sides.
                */
                if (target === 'client') {
                    const contents = `import { remoteProxy as __belteRemoteProxy__ } from 'belte/browser/remoteProxy';
export const ${prepared.exportName} = __belteRemoteProxy__(${JSON.stringify(prepared.verb)}, ${JSON.stringify(url)});
`
                    return { contents, loader: 'ts' }
                }
                /*
                Server target: strip the user's verb import, then rewrite
                the `<VERB>(` call so the verb (from the identifier) and
                the URL (from the file path) are threaded into the
                runtime constructor — defineVerb. The user's handler body
                stays intact between the parens; any generics on the call
                are dropped (they carry no runtime info). Rewriting is
                tokenizer-driven so `GET` mentions inside strings and
                comments are left alone.
                */
                const banner = `import { defineVerb as __belteDefineVerb__ } from 'belte/server/rpc/defineVerb';
`
                return { contents: `${banner}${prepared.rewriteForServer(url)}`, loader: 'ts' }
            })

            build.onLoad({ filter: socketsFilter }, async (args) => {
                if (!args.path.startsWith(`${socketsDir}/`)) {
                    return undefined
                }
                const relativePath = args.path.slice(socketsDir.length + 1)
                const source = await Bun.file(args.path).text()
                const name = socketNameForFile(relativePath)
                const prepared = prepareSocketModule(source)
                if (!prepared) {
                    throw new Error(
                        `[belte] src/server/sockets/${relativePath} has no \`export const <name> = socket(...)\` — every $sockets module must declare exactly one socket`,
                    )
                }
                const expectedName = relativePath.replace(/\.ts$/, '').split('/').pop() ?? ''
                if (prepared.exportName !== expectedName) {
                    throw new Error(
                        `[belte] src/server/sockets/${relativePath} exports \`${prepared.exportName}\` but the filename expects \`${expectedName}\` — the export name must match the file's stem`,
                    )
                }
                if (target === 'client') {
                    /*
                    Client bundle gets a name-only stub — opts (history,
                    clientPublish) are server-side state and don't
                    affect the client's wire behaviour.
                    */
                    const contents = `import { socketProxy as __belteSocketProxy__ } from 'belte/browser/socketProxy';
export const ${prepared.exportName} = __belteSocketProxy__(${JSON.stringify(name)});
`
                    return { contents, loader: 'ts' }
                }
                const banner = `import { defineSocket as __belteDefineSocket__ } from 'belte/server/sockets/defineSocket';
`
                return {
                    contents: `${banner}${prepared.rewriteForServer(name)}`,
                    loader: 'ts',
                }
            })

            build.onLoad({ filter: promptsFilter }, async (args) => {
                if (!args.path.startsWith(`${promptsDir}/`)) {
                    return undefined
                }
                /*
                Prompts are MCP-only — no client-side counterpart. The
                client bundle never imports a prompts module, but emit an
                empty stub for the client target defensively so a stray
                import can't drag the render body into the browser bundle.
                */
                if (target === 'client') {
                    return { contents: 'export {}', loader: 'ts' }
                }
                const relativePath = args.path.slice(promptsDir.length + 1)
                const source = await Bun.file(args.path).text()
                const name = promptNameForFile(relativePath)
                const prepared = preparePromptModule(source)
                if (!prepared) {
                    throw new Error(
                        `[belte] src/mcp/prompts/${relativePath} has no \`export const <name> = prompt(...)\` — every prompts module must declare exactly one prompt`,
                    )
                }
                const expectedName = relativePath.replace(/\.ts$/, '').split('/').pop() ?? ''
                if (prepared.exportName !== expectedName) {
                    throw new Error(
                        `[belte] src/mcp/prompts/${relativePath} exports \`${prepared.exportName}\` but the filename expects \`${expectedName}\` — the export name must match the file's stem`,
                    )
                }
                const banner = `import { definePrompt as __belteDefinePrompt__ } from 'belte/server/prompts/definePrompt';
`
                return {
                    contents: `${banner}${prepared.rewriteForServer(name)}`,
                    loader: 'ts',
                }
            })

            build.onLoad({ filter: /.*/, namespace: NS }, async (args) => {
                if (args.path === 'belte:rpc') {
                    const files = await scanRpcOnce()
                    const byUrl = files
                        .toSorted()
                        .map((file) => ({ url: rpcUrlForFile(file), file }))
                    const entries = byUrl
                        .map(
                            ({ url, file }) =>
                                `    ${JSON.stringify(url)}: () => import(${JSON.stringify(`${rpcDir}/${file}`)}),`,
                        )
                        .join('\n')
                    if (byUrl.length > 0) {
                        log.info(
                            `resolved ${byUrl.length} rpc modules: ${byUrl.map((b) => b.url).join(', ')}`,
                        )
                    }
                    return {
                        contents: `export const rpc = {\n${entries}\n}\n`,
                        loader: 'js',
                    }
                }

                if (args.path === 'belte:sockets') {
                    const files = await scanSocketsOnce()
                    const byName = files
                        .toSorted()
                        .map((file) => ({ name: socketNameForFile(file), file }))
                    const entries = byName
                        .map(
                            ({ name, file }) =>
                                `    ${JSON.stringify(name)}: () => import(${JSON.stringify(`${socketsDir}/${file}`)}),`,
                        )
                        .join('\n')
                    if (byName.length > 0) {
                        log.info(
                            `resolved ${byName.length} socket modules: ${byName.map((b) => b.name).join(', ')}`,
                        )
                    }
                    return {
                        contents: `export const sockets = {\n${entries}\n}\n`,
                        loader: 'js',
                    }
                }

                if (args.path === 'belte:prompts') {
                    const files = await scanPromptsOnce()
                    const byName = files
                        .toSorted()
                        .map((file) => ({ name: promptNameForFile(file), file }))
                    const entries = byName
                        .map(
                            ({ name, file }) =>
                                `    ${JSON.stringify(name)}: () => import(${JSON.stringify(`${promptsDir}/${file}`)}),`,
                        )
                        .join('\n')
                    if (byName.length > 0) {
                        log.info(
                            `resolved ${byName.length} prompt modules: ${byName.map((b) => b.name).join(', ')}`,
                        )
                    }
                    return {
                        contents: `export const prompts = {\n${entries}\n}\n`,
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

                if (args.path === 'belte:cli-manifest') {
                    /*
                    The CLI binary's bake-time manifest. Discovery (a
                    one-shot script the bundler runs separately) writes
                    `${cwd}/dist/cli-manifest.json` from the populated
                    verbRegistry; this virtual splices that JSON in as a
                    default-exported object. Empty manifest when the
                    discovery file is missing — the binary still works
                    but exposes no subcommands until the user runs the
                    full `belte cli` flow.
                    */
                    const manifestPath = `${cwd}/dist/cli-manifest.json`
                    if (!existsSync(manifestPath)) {
                        return { contents: 'export default {}', loader: 'js' }
                    }
                    const json = await Bun.file(manifestPath).text()
                    return { contents: `export default ${json}`, loader: 'js' }
                }

                if (args.path === 'belte:cli-name') {
                    /*
                    Program name shown in `<program> --help`. Reads the
                    project's package.json `name` field (scoped names keep
                    only the final segment), falling back to `app` when
                    missing.
                    */
                    const pkgPath = `${cwd}/package.json`
                    if (!existsSync(pkgPath)) {
                        return { contents: 'export default "app"', loader: 'js' }
                    }
                    const pkg = (await Bun.file(pkgPath).json()) as { name?: string }
                    const name = programNameForPackage(pkg.name)
                    return { contents: `export default ${JSON.stringify(name)}`, loader: 'js' }
                }

                if (args.path === 'belte:cli-chrome') {
                    /*
                    Optional CLI help chrome baked into the binary: src/cli/
                    banner.txt prints atop top-level help, footer.txt prints
                    below it. Missing files emit empty strings (no chrome).
                    Read as plain text, like belte:shell.
                    */
                    const bannerFile = `${cliDir}/banner.txt`
                    const footerFile = `${cliDir}/footer.txt`
                    const banner = (await Bun.file(bannerFile).exists())
                        ? await Bun.file(bannerFile).text()
                        : ''
                    const footer = (await Bun.file(footerFile).exists())
                        ? await Bun.file(footerFile).text()
                        : ''
                    return {
                        contents: `export const banner = ${JSON.stringify(banner)}
export const footer = ${JSON.stringify(footer)}
`,
                        loader: 'js',
                    }
                }

                if (args.path === 'belte:app-info') {
                    /*
                    Project identity ({ name, version }) read from
                    package.json, surfaced in the OpenAPI document's `info`
                    block. Falls back to placeholder values when the file
                    is missing so the spec still emits.
                    */
                    const pkgPath = `${cwd}/package.json`
                    if (!existsSync(pkgPath)) {
                        return {
                            contents: 'export const appInfo = { name: "app", version: "0.0.0" }',
                            loader: 'js',
                        }
                    }
                    const pkg = (await Bun.file(pkgPath).json()) as {
                        name?: string
                        version?: string
                    }
                    const info = { name: pkg.name ?? 'app', version: pkg.version ?? '0.0.0' }
                    return {
                        contents: `export const appInfo = ${JSON.stringify(info)}`,
                        loader: 'js',
                    }
                }

                if (args.path === 'belte:cli-rpcs') {
                    /*
                    Eager-import side-effect bundle for the FULL CLI
                    binary. Importing every rpc module fires defineVerb
                    so the verbRegistry is populated and createClient's
                    in-process fallback can dispatch. Thin builds emit
                    an empty module — the binary speaks remote-only.

                    `thin` is set by buildCli (default full — it passes
                    `thin: false` unless `--thin`). Defaults to full here
                    too so a stray APP_URL in the build environment can't
                    silently thin the bundle.
                    */
                    const isThin = thin ?? false
                    if (isThin) {
                        return { contents: 'export {}', loader: 'js' }
                    }
                    const files = await scanRpcOnce()
                    const lines = files.map(
                        (file) => `import ${JSON.stringify(`${rpcDir}/${file}`)}`,
                    )
                    return { contents: `${lines.join('\n')}\nexport {}`, loader: 'js' }
                }

                if (args.path === 'belte:mcp') {
                    /*
                    The MCP server is fully framework-generated — tools from
                    the verb registry, prompts from src/mcp/prompts, resources
                    from src/mcp/resources. createMcpServer is internal; there
                    is no user-authored server module.
                    */
                    return {
                        contents:
                            "import { createMcpServer } from 'belte/mcp/createMcpServer'\nexport default createMcpServer()\n",
                        loader: 'js',
                    }
                }

                if (args.path === 'belte:assets') {
                    if (!embedAssets) {
                        return { contents: 'export const assets = undefined', loader: 'js' }
                    }
                    const appDir = `${cwd}/dist/_app`
                    const files = await Array.fromAsync(
                        new Glob('**/*.zst').scan({ cwd: appDir, onlyFiles: true }),
                    )
                    const encoded = await Promise.all(
                        files.map(async (file) => {
                            const bytes = await Bun.file(`${appDir}/${file}`).bytes()
                            const urlPath = `/_app/${file.replace(/\.zst$/, '')}`
                            return {
                                line: `    ${JSON.stringify(urlPath)}: _d(${JSON.stringify(bytes.toBase64())}),`,
                                bytes: bytes.byteLength,
                            }
                        }),
                    )
                    const entries = encoded.map((entry) => entry.line)
                    const totalBytes = encoded.reduce((total, entry) => total + entry.bytes, 0)
                    log.info(
                        `embedded ${encoded.length} zstd assets from dist/_app/ (${(totalBytes / 1024).toFixed(1)} KiB)`,
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

                if (args.path === 'belte:public-assets') {
                    /*
                    Embeds every file under public/ (zstd level 22, paid
                    once at compile) keyed by its site-root path so the
                    standalone binary serves them without a public/ dir on
                    disk. Mirrors belte:assets. Empty/undefined when not
                    embedding (dev + `belte start` read public/ off disk).
                    */
                    if (!embedAssets || !existsSync(publicDir)) {
                        return {
                            contents: 'export const publicAssets = undefined',
                            loader: 'js',
                        }
                    }
                    const files = await Array.fromAsync(
                        new Glob('**/*').scan({ cwd: publicDir, onlyFiles: true }),
                    )
                    if (files.length === 0) {
                        return {
                            contents: 'export const publicAssets = undefined',
                            loader: 'js',
                        }
                    }
                    const encoded = await Promise.all(
                        files.map(async (file) => {
                            const bytes = await Bun.file(`${publicDir}/${file}`).bytes()
                            const compressed = Bun.zstdCompressSync(bytes, { level: 22 })
                            return {
                                line: `    ${JSON.stringify(`/${file}`)}: _d(${JSON.stringify(compressed.toBase64())}),`,
                                bytes: compressed.byteLength,
                            }
                        }),
                    )
                    const totalBytes = encoded.reduce((total, entry) => total + entry.bytes, 0)
                    log.info(
                        `embedded ${encoded.length} public files from public/ (${(totalBytes / 1024).toFixed(1)} KiB zstd)`,
                    )
                    return {
                        contents: `const _d = (s) => Uint8Array.fromBase64(s)
export const publicAssets = {
${encoded.map((entry) => entry.line).join('\n')}
}
`,
                        loader: 'js',
                    }
                }

                if (args.path === 'belte:mcp-resources') {
                    /*
                    Embeds every file under src/mcp/resources/ (zstd level
                    22) keyed by its path relative to that dir, so the
                    standalone binary serves MCP resources without the folder
                    on disk. Mirrors belte:public-assets. Undefined when not
                    embedding (dev + `belte start` read off disk).
                    */
                    if (!embedAssets || !existsSync(resourcesDir)) {
                        return {
                            contents: 'export const mcpResources = undefined',
                            loader: 'js',
                        }
                    }
                    const files = await Array.fromAsync(
                        new Glob('**/*').scan({ cwd: resourcesDir, onlyFiles: true }),
                    )
                    if (files.length === 0) {
                        return {
                            contents: 'export const mcpResources = undefined',
                            loader: 'js',
                        }
                    }
                    const encoded = await Promise.all(
                        files.map(async (file) => {
                            const bytes = await Bun.file(`${resourcesDir}/${file}`).bytes()
                            const compressed = Bun.zstdCompressSync(bytes, { level: 22 })
                            return {
                                line: `    ${JSON.stringify(file)}: _d(${JSON.stringify(compressed.toBase64())}),`,
                                bytes: compressed.byteLength,
                            }
                        }),
                    )
                    const totalBytes = encoded.reduce((total, entry) => total + entry.bytes, 0)
                    log.info(
                        `embedded ${encoded.length} mcp resources from src/mcp/resources/ (${(totalBytes / 1024).toFixed(1)} KiB zstd)`,
                    )
                    return {
                        contents: `const _d = (s) => Uint8Array.fromBase64(s)
export const mcpResources = {
${encoded.map((entry) => entry.line).join('\n')}
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
Walks src/browser/pages once and partitions every `.svelte` file into pages
and layouts. Rejects any other file shape — pages and layouts must live in
their own folders (or directly under `src/browser/pages/` for the root) and the
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
            `[belte] src/browser/pages/${file} is not a recognized page file — every page must live in its own folder as page.svelte or layout.svelte (try src/browser/pages/${parent}${stem}/page.svelte)`,
        )
    }
    return { pageFiles, layoutFiles }
}

/*
Walks src/server/rpc once. Every `.ts` file is an HTTP-verb rpc handler. Returns
an empty list when the directory doesn't exist so a pages-only app
builds without an `rpc/` folder.
*/
async function scanRpc(rpcDir: string): Promise<string[]> {
    if (!existsSync(rpcDir)) {
        return []
    }
    return await Array.fromAsync(new Glob('**/*.ts').scan({ cwd: rpcDir }))
}

/*
Walks src/server/sockets once. Each `.ts` file declares one socket; the
dispatcher loads modules lazily on first sub/pub frame. Returns an
empty list when the directory doesn't exist.
*/
async function scanSockets(socketsDir: string): Promise<string[]> {
    if (!existsSync(socketsDir)) {
        return []
    }
    return await Array.fromAsync(new Glob('**/*.ts').scan({ cwd: socketsDir }))
}

/*
Walks src/mcp/prompts once. Each `.ts` file declares one MCP prompt.
Returns an empty list when the directory doesn't exist so an app without
prompts builds the same.
*/
async function scanPrompts(promptsDir: string): Promise<string[]> {
    if (!existsSync(promptsDir)) {
        return []
    }
    return await Array.fromAsync(new Glob('**/*.ts').scan({ cwd: promptsDir }))
}

/*
Picks `src/browser/app.html` when it exists, otherwise the bundled default
shell. Reads the file once per build so the resolver's two virtual passes share
a single disk hit. Rewrites the literal `/_app/client.js` and `/_app/client.css`
references to the hashed entry filenames emitted by the client build so the
entry bundles can be served with `immutable` cache headers like the chunks.
*/
async function loadShell(cwd: string): Promise<string> {
    const userShell = `${cwd}/src/browser/app.html`
    const defaultShell = new URL('./assets/app.html', import.meta.url).pathname
    const filepath = (await Bun.file(userShell).exists()) ? userShell : defaultShell
    if (filepath === userShell) {
        log.info('using custom src/browser/app.html')
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
    let jsEntry: string | undefined
    let cssEntry: string | undefined
    for (const file of entries) {
        if (!jsEntry && /^client-[a-z0-9]+\.js$/i.test(file)) {
            jsEntry = file
            continue
        }
        if (!cssEntry && /^client-[a-z0-9]+\.css$/i.test(file)) {
            cssEntry = file
        }
    }
    let result = shell
    if (jsEntry) {
        result = result.replace('/_app/client.js', `/_app/${jsEntry}`)
    }
    if (cssEntry) {
        result = result.replace('/_app/client.css', `/_app/${cssEntry}`)
    }
    return result
}
