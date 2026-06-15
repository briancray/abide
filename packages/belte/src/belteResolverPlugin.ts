// node:fs existsSync — Bun plugin onResolve is sync-only; Bun.file().exists() is async
import { existsSync, statSync } from 'node:fs'
import type { BunPlugin } from 'bun'
import { Glob } from 'bun'
import { belteImportName } from './lib/shared/belteImportName.ts'
import { belteLog } from './lib/shared/belteLog.ts'
import { fileStem } from './lib/shared/fileStem.ts'
import { jsonSchemaForPromptArguments } from './lib/shared/jsonSchemaForPromptArguments.ts'
import { manifestModule } from './lib/shared/manifestModule.ts'
import { pageUrlForFile } from './lib/shared/pageUrlForFile.ts'
import { parsePromptMarkdown } from './lib/shared/parsePromptMarkdown.ts'
import { prepareRpcModule } from './lib/shared/prepareRpcModule.ts'
import { prepareSocketModule } from './lib/shared/prepareSocketModule.ts'
import { programNameForPackage } from './lib/shared/programNameForPackage.ts'
import { promptNameForFile } from './lib/shared/promptNameForFile.ts'
import { readPackageJson } from './lib/shared/readPackageJson.ts'
import { rpcUrlForFile } from './lib/shared/rpcUrlForFile.ts'
import { socketNameForFile } from './lib/shared/socketNameForFile.ts'
import { writeHealthDts } from './lib/shared/writeHealthDts.ts'
import { writePublicAssetsDts } from './lib/shared/writePublicAssetsDts.ts'
import { writeRoutesDts } from './lib/shared/writeRoutesDts.ts'
import { writeRpcDts } from './lib/shared/writeRpcDts.ts'
import { writeTestRpcDts } from './lib/shared/writeTestRpcDts.ts'
import { writeTestSocketsDts } from './lib/shared/writeTestSocketsDts.ts'

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

const RESOLVE_EXTENSIONS = ['.ts', '.js', '.tsx', '.jsx']

function resolveExtensionUncached(path: string): string {
    if (existsSync(path) && !statSync(path).isDirectory()) {
        return path
    }
    for (const extension of RESOLVE_EXTENSIONS) {
        if (existsSync(`${path}${extension}`)) {
            return `${path}${extension}`
        }
    }
    for (const extension of RESOLVE_EXTENSIONS) {
        const indexPath = `${path}/index${extension}`
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

/* Memoises a zero-arg async producer so repeat calls reuse the first in-flight promise. */
function once<T>(produce: () => Promise<T>): () => Promise<T> {
    let promise: Promise<T> | undefined
    return () => {
        if (!promise) {
            promise = produce()
        }
        return promise
    }
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
// @readme plumbing
export function belteResolverPlugin({
    cwd = process.cwd(),
    embedAssets = false,
    target = 'server',
}: {
    cwd?: string
    embedAssets?: boolean
    target?: 'server' | 'client'
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
    The bare specifier the project imports belte under (canonical
    `@belte/belte` or a package alias). Resolved once from the project's
    package.json and threaded into every generated module so the codegen's
    imports resolve regardless of which install style the project uses.
    */
    const belteImportNameOnce = once(() => belteImportName(cwd))
    /*
    The whole-tree validation + per-leaf classification only needs to run
    once per build. Memoise the promise so the virtual manifests
    (rpc/sockets/pages/layouts) share a single scan instead of each one
    re-globbing the trees. The shell read is memoised the same way so two
    passes don't re-read app.html from disk.
    */
    const scanPagesOnce = once(() =>
        scanPages(pagesDir).then(async (scan) => {
            await writeRoutesDts({
                cwd,
                pageFiles: scan.pageFiles,
                importName: await belteImportNameOnce(),
            })
            return scan
        }),
    )
    const scanRpcOnce = once(() =>
        scanDir(rpcDir, '**/*.ts').then(async (rpcFiles) => {
            const importName = await belteImportNameOnce()
            await writeRpcDts({ cwd, rpcDir, rpcFiles, importName })
            /* Typed createTestApp `app.rpc.<verb>` surface. */
            await writeTestRpcDts({ cwd, rpcFiles, importName })
            return rpcFiles
        }),
    )
    const scanSocketsOnce = once(() =>
        scanDir(socketsDir, '**/*.ts').then(async (socketFiles) => {
            /* Typed createTestApp `app.sockets.<name>` surface. */
            await writeTestSocketsDts({
                cwd,
                socketFiles,
                importName: await belteImportNameOnce(),
            })
            return socketFiles
        }),
    )
    /* One write per build, from the belte:app loader (the seam that already knows whether src/app.ts exists). */
    let healthDtsWritten: Promise<void> | undefined
    const writeHealthDtsOnce = (hasAppModule: boolean): Promise<void> => {
        healthDtsWritten ??= belteImportNameOnce().then((importName) =>
            writeHealthDts({ cwd, hasAppModule, importName }),
        )
        return healthDtsWritten
    }
    /*
    Globs public/ once per build and writes publicAssets.d.ts so url() can
    autocomplete known assets — independent of embedding (runs in dev/start
    too, where the files are read off disk). The public-assets virtual reuses
    the returned list for its embed.
    */
    const scanPublicOnce = once(async () => {
        const publicFiles = existsSync(publicDir)
            ? await Array.fromAsync(new Glob('**/*').scan({ cwd: publicDir, onlyFiles: true }))
            : []
        await writePublicAssetsDts({ cwd, publicFiles, importName: await belteImportNameOnce() })
        return publicFiles
    })
    const scanPromptsOnce = once(() => scanDir(promptsDir, '**/*.md'))
    const loadShellOnce = once(() => loadShell(cwd))
    /* Project package.json read once per build — three virtuals (cli-name,
       app-info, mcp identity) derive fields from it. */
    const readPackageJsonOnce = once(() => readPackageJson(cwd))

    const rpcFilter = new RegExp(`^${escapeRegex(rpcDir)}/.*\\.ts$`)
    const socketsFilter = new RegExp(`^${escapeRegex(socketsDir)}/.*\\.ts$`)
    const promptsFilter = new RegExp(`^${escapeRegex(promptsDir)}/.*\\.md$`)

    return {
        name: 'belte-resolver',
        setup(build) {
            build.onResolve(
                {
                    filter: /\/_virtual\/(rpc|sockets|prompts|pages|layouts|errors|app|config|mcp-resources|mcp|assets|public-assets|shell|app-info|cli-manifest|cli-name|cli-chrome|bundle-window|bundle-disconnected-component|bundle-disconnected)\.ts$/,
                },
                (args) => {
                    const name = fileStem(args.path)
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
            const dirAliases: Record<string, string> = {
                $server: serverDir,
                $browser: browserDir,
                $shared: sharedDir,
                $mcp: mcpDir,
                $cli: cliDir,
            }
            for (const [alias, baseDir] of Object.entries(dirAliases)) {
                build.onResolve({ filter: new RegExp(`^\\${alias}(\\/.*)?$`) }, (args) => {
                    const subpath = args.path.slice(alias.length)
                    return { path: resolveExtension(subpath ? `${baseDir}${subpath}` : baseDir) }
                })
            }

            /*
            Root-absolute url() references in stylesheets (e.g.
            `url(/fonts/x.woff2)`) point at files served from public/ at the
            site root at runtime, not at anything on disk at build time. Bun's
            CSS bundler otherwise tries to resolve them against the project
            root and fails the whole build. Mark them external so the literal
            `/…` path survives into the emitted CSS, where
            createPublicAssetServer serves it. Scoped to CSS importers: svelte
            <style> blocks compile to injected JS strings and never reach the
            CSS bundler, and belte's own absolute-path JS imports come from
            .ts/virtual importers — neither is a `.css` importer, so both are
            untouched. Relative url()s (`./x.png`) still resolve and bundle
            normally.
            */
            build.onResolve({ filter: /^\// }, (args) => {
                if (args.importer.endsWith('.css')) {
                    return { path: args.path, external: true }
                }
                return undefined
            })

            build.onLoad({ filter: rpcFilter }, async (args) => {
                if (!args.path.startsWith(`${rpcDir}/`)) {
                    return undefined
                }
                const relativePath = args.path.slice(rpcDir.length + 1)
                const source = await Bun.file(args.path).text()
                const url = rpcUrlForFile(relativePath)
                const importName = await belteImportNameOnce()
                const prepared = prepareRpcModule(source, importName)
                if (!prepared) {
                    throw new Error(
                        `[belte] src/server/rpc/${relativePath} has no \`export const <name> = <VERB>(...)\` — every $rpc module must declare exactly one remote function`,
                    )
                }
                const expectedName = fileStem(relativePath)
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
                    const contents = `import { remoteProxy as __belteRemoteProxy__ } from '${importName}/browser/remoteProxy';
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
                const banner = `import { defineVerb as __belteDefineVerb__ } from '${importName}/server/rpc/defineVerb';
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
                const importName = await belteImportNameOnce()
                const prepared = prepareSocketModule(source, importName)
                if (!prepared) {
                    throw new Error(
                        `[belte] src/server/sockets/${relativePath} has no \`export const <name> = socket(...)\` — every $sockets module must declare exactly one socket`,
                    )
                }
                const expectedName = fileStem(relativePath)
                if (prepared.exportName !== expectedName) {
                    throw new Error(
                        `[belte] src/server/sockets/${relativePath} exports \`${prepared.exportName}\` but the filename expects \`${expectedName}\` — the export name must match the file's stem`,
                    )
                }
                if (target === 'client') {
                    /*
                    Client bundle gets a name-only stub — opts (tail,
                    clientPublish) are server-side state and don't
                    affect the client's wire behaviour.
                    */
                    const contents = `import { socketProxy as __belteSocketProxy__ } from '${importName}/browser/socketProxy';
export const ${prepared.exportName} = __belteSocketProxy__(${JSON.stringify(name)});
`
                    return { contents, loader: 'ts' }
                }
                const banner = `import { defineSocket as __belteDefineSocket__ } from '${importName}/server/sockets/defineSocket';
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
                import can't drag the prompt body into the browser bundle.
                */
                if (target === 'client') {
                    return { contents: 'export {}', loader: 'ts' }
                }
                /*
                Server target: a `.md` prompt is data, not code. Parse the
                frontmatter (description + arguments) and body once, then
                generate a module that registers the prompt via definePrompt
                — the body is embedded as a string literal and the render
                closure interpolates `{{name}}` placeholders at call time.
                */
                const relativePath = args.path.slice(promptsDir.length + 1)
                const source = await Bun.file(args.path).text()
                const name = promptNameForFile(relativePath)
                const importName = await belteImportNameOnce()
                const parsed = parsePromptMarkdown(source)
                const jsonSchema = jsonSchemaForPromptArguments(parsed.arguments)
                const optionLines = [
                    parsed.description
                        ? `    description: ${JSON.stringify(parsed.description)},`
                        : undefined,
                    jsonSchema ? `    jsonSchema: ${JSON.stringify(jsonSchema)},` : undefined,
                    `    render: (args) => __belteRenderPromptTemplate__(__template__, args),`,
                ]
                    .filter((line) => line !== undefined)
                    .join('\n')
                const contents = `import { definePrompt as __belteDefinePrompt__ } from '${importName}/server/prompts/definePrompt'
import { renderPromptTemplate as __belteRenderPromptTemplate__ } from '${importName}/server/prompts/renderPromptTemplate'
const __template__ = ${JSON.stringify(parsed.body)}
export const prompt = __belteDefinePrompt__(${JSON.stringify(name)}, {
${optionLines}
})
`
                return { contents, loader: 'ts' }
            })

            build.onLoad({ filter: /.*/, namespace: NS }, async (args) => {
                if (args.path === 'belte:rpc') {
                    return manifestModule({
                        files: await scanRpcOnce(),
                        keyForFile: rpcUrlForFile,
                        importDir: rpcDir,
                        exportName: 'rpc',
                    })
                }

                if (args.path === 'belte:sockets') {
                    return manifestModule({
                        files: await scanSocketsOnce(),
                        keyForFile: socketNameForFile,
                        importDir: socketsDir,
                        exportName: 'sockets',
                    })
                }

                if (args.path === 'belte:prompts') {
                    return manifestModule({
                        files: await scanPromptsOnce(),
                        keyForFile: promptNameForFile,
                        importDir: promptsDir,
                        exportName: 'prompts',
                        label: 'prompt modules',
                    })
                }

                if (args.path === 'belte:pages') {
                    const { pageFiles } = await scanPagesOnce()
                    return manifestModule({
                        files: pageFiles,
                        keyForFile: pageUrlForFile,
                        importDir: pagesDir,
                        exportName: 'pages',
                    })
                }

                if (args.path === 'belte:layouts') {
                    const { layoutFiles } = await scanPagesOnce()
                    return manifestModule({
                        files: layoutFiles,
                        keyForFile: pageUrlForFile,
                        importDir: pagesDir,
                        exportName: 'layouts',
                    })
                }

                if (args.path === 'belte:errors') {
                    const { errorFiles } = await scanPagesOnce()
                    return manifestModule({
                        files: errorFiles,
                        keyForFile: pageUrlForFile,
                        importDir: pagesDir,
                        exportName: 'errors',
                        label: 'error pages',
                    })
                }

                if (args.path === 'belte:app') {
                    const userApp = `${cwd}/src/app.ts`
                    const hasAppModule = await Bun.file(userApp).exists()
                    /* health.d.ts keys the client health() read to the app hook's return type. */
                    await writeHealthDtsOnce(hasAppModule)
                    if (hasAppModule) {
                        belteLog.info('using custom src/app.ts')
                        return {
                            contents: `export * from ${JSON.stringify(userApp)}`,
                            loader: 'js',
                        }
                    }
                    return { contents: 'export {};', loader: 'js' }
                }

                if (args.path === 'belte:config') {
                    /*
                    Re-exports src/server/config.ts so serverEntry can eager-import
                    it at boot — running its `env(schema)` validation once the env
                    layers are merged, before the server starts. Optional: an empty
                    stub when absent, so an app with no config builds and boots the
                    same (it just reads Bun.env directly).
                    */
                    const userConfig = `${serverDir}/config.ts`
                    if (await Bun.file(userConfig).exists()) {
                        belteLog.info('using src/server/config.ts')
                        return {
                            contents: `export * from ${JSON.stringify(userConfig)}`,
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
                    const pkg = await readPackageJsonOnce()
                    const name = programNameForPackage(pkg?.name as string | undefined)
                    return { contents: `export default ${JSON.stringify(name)}`, loader: 'js' }
                }

                if (args.path === 'belte:bundle-window') {
                    /*
                    Optional bundle window config (title/size/menu) baked into
                    the bundled launcher. Re-exports the default from
                    src/bundle/window.ts when present; otherwise an empty
                    object so the launcher falls back to its defaults.
                    */
                    const userFile = `${cwd}/src/bundle/window.ts`
                    if (existsSync(userFile)) {
                        belteLog.info('using custom src/bundle/window.ts')
                        return {
                            contents: `export { default } from ${JSON.stringify(userFile)}`,
                            loader: 'js',
                        }
                    }
                    return { contents: 'export default {}', loader: 'js' }
                }

                if (args.path === 'belte:bundle-disconnected') {
                    /*
                    The connect screen HTML baked into the launcher. buildDisconnected
                    writes `${cwd}/dist/bundle-disconnected.html`; this virtual splices
                    it in as a string export. A minimal inline fallback keeps the
                    launcher buildable when the file is missing (the screen still loads,
                    just unstyled) — bundleApp always builds it first.
                    */
                    const htmlPath = `${cwd}/dist/bundle-disconnected.html`
                    if (!existsSync(htmlPath)) {
                        const fallback =
                            '<!doctype html><html><body><div id="app">belte</div></body></html>'
                        return {
                            contents: `export const disconnectedHtml = ${JSON.stringify(fallback)}`,
                            loader: 'js',
                        }
                    }
                    const html = await Bun.file(htmlPath).text()
                    return {
                        contents: `export const disconnectedHtml = ${JSON.stringify(html)}`,
                        loader: 'js',
                    }
                }

                if (args.path === 'belte:bundle-disconnected-component') {
                    /*
                    The belte-ui component the connect-screen build mounts: the project's
                    src/bundle/disconnected.belte override when present, otherwise the lib
                    default. Re-exports the default like belte:bundle-window; the belte-ui
                    `.belte` loader compiles the target either way.
                    */
                    const userFile = `${cwd}/src/bundle/disconnected.belte`
                    if (existsSync(userFile)) {
                        belteLog.info('using custom src/bundle/disconnected.belte')
                        return {
                            contents: `export { default } from ${JSON.stringify(userFile)}`,
                            loader: 'js',
                        }
                    }
                    const defaultFile = new URL('./lib/bundle/disconnected.belte', import.meta.url)
                        .pathname
                    return {
                        contents: `export { default } from ${JSON.stringify(defaultFile)}`,
                        loader: 'js',
                    }
                }

                if (args.path === 'belte:cli-chrome') {
                    /*
                    Optional CLI help chrome baked into the binary: src/cli/
                    banner.txt prints atop top-level help, footer.txt prints
                    below it. Missing files emit empty strings (no chrome).
                    Read as plain text, like belte:shell.
                    */
                    const readChrome = async (name: string) => {
                        const file = Bun.file(`${cliDir}/${name}`)
                        return (await file.exists()) ? await file.text() : ''
                    }
                    const [banner, footer] = await Promise.all([
                        readChrome('banner.txt'),
                        readChrome('footer.txt'),
                    ])
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
                    const pkg = await readPackageJsonOnce()
                    const info = {
                        name: (pkg?.name as string | undefined) ?? 'app',
                        version: (pkg?.version as string | undefined) ?? '0.0.0',
                    }
                    return {
                        contents: `export const appInfo = ${JSON.stringify(info)}`,
                        loader: 'js',
                    }
                }

                if (args.path === 'belte:mcp') {
                    /*
                    The MCP server is fully framework-generated — tools from
                    the verb registry, prompts from src/mcp/prompts, resources
                    from src/mcp/resources. createMcpServer is internal; there
                    is no user-authored server module. Server identity comes
                    from package.json so the `mcp__<name>__*` permission prefix
                    is stable and app-specific; absent a name, createMcpServer
                    falls back to its own default.
                    */
                    const importName = await belteImportNameOnce()
                    const pkg = await readPackageJsonOnce()
                    /* JSON.stringify drops undefined keys, so an absent name/version
                       leaves createMcpServer to apply its own defaults. */
                    const identity = JSON.stringify({
                        name: pkg?.name as string | undefined,
                        version: pkg?.version as string | undefined,
                    })
                    return {
                        contents: `import { createMcpServer } from '${importName}/mcp/createMcpServer'\nexport default createMcpServer(${identity})\n`,
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
                    const contents = await embedZstdDir({
                        dir: appDir,
                        files,
                        keyFor: (file) => `/_app/${file.replace(/\.zst$/, '')}`,
                        precompressed: true,
                        exportName: 'assets',
                        label: 'zstd assets',
                        source: 'dist/_app/',
                    })
                    return { contents, loader: 'js' }
                }

                if (args.path === 'belte:public-assets') {
                    /*
                    Embeds every file under public/ (zstd level 22, paid
                    once at compile) keyed by its site-root path so the
                    standalone binary serves them without a public/ dir on
                    disk. Mirrors belte:assets. Empty/undefined when not
                    embedding (dev + `belte start` read public/ off disk).
                    */
                    // Globs public/ and writes publicAssets.d.ts every build; reuse the list to embed.
                    const files = await scanPublicOnce()
                    if (!embedAssets || files.length === 0) {
                        return {
                            contents: 'export const publicAssets = undefined',
                            loader: 'js',
                        }
                    }
                    const contents = await embedZstdDir({
                        dir: publicDir,
                        files,
                        keyFor: (file) => `/${file}`,
                        precompressed: false,
                        exportName: 'publicAssets',
                        label: 'public files',
                        source: 'public/',
                    })
                    return { contents, loader: 'js' }
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
                    const contents = await embedZstdDir({
                        dir: resourcesDir,
                        files,
                        keyFor: (file) => file,
                        precompressed: false,
                        exportName: 'mcpResources',
                        label: 'mcp resources',
                        source: 'src/mcp/resources/',
                    })
                    return { contents, loader: 'js' }
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

/*
Encodes every file in `files` (relative to `dir`) into a base64 zstd map and
emits `export const <exportName> = { "<key>": _d("<base64>") }`. `keyFor` maps
a relative path to its lookup key; `precompressed` true means the files are
already `.zst` on disk (read + base64 as-is), false means compress here at
level 22. Shared by the belte:assets / belte:public-assets / belte:mcp-resources
virtuals, which differ only in source dir, key shape, and whether the inputs
are pre-compressed.
*/
async function embedZstdDir({
    dir,
    files,
    keyFor,
    precompressed,
    exportName,
    label,
    source,
}: {
    dir: string
    files: string[]
    keyFor: (file: string) => string
    precompressed: boolean
    exportName: string
    label: string
    source: string
}): Promise<string> {
    const encoded = await Promise.all(
        files.map(async (file) => {
            const raw = await Bun.file(`${dir}/${file}`).bytes()
            const bytes = precompressed ? raw : await Bun.zstdCompress(raw, { level: 22 })
            return {
                line: `    ${JSON.stringify(keyFor(file))}: _d(${JSON.stringify(bytes.toBase64())}),`,
                bytes: bytes.byteLength,
            }
        }),
    )
    const totalBytes = encoded.reduce((total, entry) => total + entry.bytes, 0)
    const unit = precompressed ? 'KiB' : 'KiB zstd'
    belteLog.info(
        `embedded ${encoded.length} ${label} from ${source} (${(totalBytes / 1024).toFixed(1)} ${unit})`,
    )
    return `const _d = (s) => Uint8Array.fromBase64(s)
export const ${exportName} = {
${encoded.map((entry) => entry.line).join('\n')}
}
`
}

type PagesScan = {
    pageFiles: string[]
    layoutFiles: string[]
    errorFiles: string[]
}

/*
Walks src/browser/pages once and collects every `page.belte` as a route — its URL
is the folder path. Layouts are userland in belte-ui (a page imports and wraps its
own), so any other `.belte` file (a Layout, a shared component) is ignored here,
free to live anywhere and be imported relatively. layoutFiles/errorFiles stay
empty — there is no framework layout/error resolution.
*/
async function scanPages(pagesDir: string): Promise<PagesScan> {
    if (!existsSync(pagesDir)) {
        return { pageFiles: [], layoutFiles: [], errorFiles: [] }
    }
    const allFiles = await Array.fromAsync(new Glob('**/*.belte').scan({ cwd: pagesDir }))
    const pageFiles = allFiles.filter((file) => (file.split('/').pop() ?? '') === 'page.belte')
    return { pageFiles, layoutFiles: [], errorFiles: [] }
}

/*
Walks one registry directory once: src/server/rpc (every `.ts` file is an
HTTP-verb rpc handler), src/server/sockets (each `.ts` file declares one
socket, loaded lazily on first sub/pub frame), or src/mcp/prompts (each `.md`
file declares one MCP prompt — frontmatter for metadata, body for the
template). Returns an empty list when the directory doesn't exist so an app
missing the folder builds the same.
*/
async function scanDir(dir: string, pattern: string): Promise<string[]> {
    if (!existsSync(dir)) {
        return []
    }
    return await Array.fromAsync(new Glob(pattern).scan({ cwd: dir }))
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
        belteLog.info('using custom src/browser/app.html')
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
