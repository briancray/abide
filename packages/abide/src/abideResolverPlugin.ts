// node:fs existsSync — Bun plugin onResolve is sync-only; Bun.file().exists() is async
import { existsSync, statSync } from 'node:fs'
import type { BunPlugin } from 'bun'
import { Glob } from 'bun'
import { abideImportName } from './lib/shared/abideImportName.ts'
import { abideLog } from './lib/shared/abideLog.ts'
import { bundleGraphFromMetafile } from './lib/shared/bundleGraphFromMetafile.ts'
import type { RpcServerProgram } from './lib/shared/createRpcServerProgram.ts'
import { escapeRegex } from './lib/shared/escapeRegex.ts'
import { fileStem } from './lib/shared/fileStem.ts'
import { jsonSchemaForPromptArguments } from './lib/shared/jsonSchemaForPromptArguments.ts'
import { manifestModule } from './lib/shared/manifestModule.ts'
import { pageUrlForFile } from './lib/shared/pageUrlForFile.ts'
import { parsePromptMarkdown } from './lib/shared/parsePromptMarkdown.ts'
import {
    DEFINE_RPC_GLOBAL,
    DEFINE_SOCKET_GLOBAL,
    REMOTE_PROXY_GLOBAL,
} from './lib/shared/RPC_SHIM_GLOBALS.ts'
import { prepareRpcModule } from './lib/shared/prepareRpcModule.ts'
import { prepareSocketModule } from './lib/shared/prepareSocketModule.ts'
import { programNameForPackage } from './lib/shared/programNameForPackage.ts'
import { promptNameForFile } from './lib/shared/promptNameForFile.ts'
import { readPackageJson } from './lib/shared/readPackageJson.ts'
import { rpcServerForRoot } from './lib/shared/rpcServerForRoot.ts'
import { rpcUrlForFile } from './lib/shared/rpcUrlForFile.ts'
import { scanPages } from './lib/shared/scanPages.ts'
import { socketNameForFile } from './lib/shared/socketNameForFile.ts'

/*
Resolves a bare directory or extensionless path to a concrete file. Mirrors
Node-style resolution (path.ts, path.js, path/index.ts, path/index.js) so
project code can use `$`-prefixed aliases like `$shared/foo/utils` that point
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

const NS = 'abide-virtual'

/* Per-input source-byte budget for the client bundle-hygiene diagnostic (ADR-0031 D2): a single
   project module that SURVIVES tree-shaking into the client bundle heavier than this earns a
   non-blocking build warning, so an accidentally-huge module (an inlined dataset, a fat vendored
   dep pulled into src) is observable without a new bundler pass. Never fails the build — the only
   hard onEnd failure stays the real side-crossing violation. */
const CLIENT_BUNDLE_INPUT_BUDGET_BYTES = 512 * 1024

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
Bun plugin that wires every virtual import abide produces at build time:
- `abide:rpc`     — { rpcUrl: () => import(rpc-module) } HTTP-method manifest
- `abide:sockets` — { socketName: () => import(socket-module) } socket manifest
- `abide:pages`   — { pageUrl: () => import(page.abide) } manifest
- `abide:layouts` — { layoutUrl: () => import(layout.abide) } layout manifest
- `abide:prompts` — { promptName: () => import(prompt-module) } manifest
- `abide:app`     — { init?, handle?, handleError?, health?, forwardHeaders? } from src/app.ts
- `abide:config`  — re-exports src/server/config.ts for boot-time env validation
- `abide:assets`  — gzip-compressed chunk bytes embedded for standalone compile
- `abide:public-assets`  — gzip-embedded src/ui/public files
- `abide:mcp-resources`  — gzip-embedded src/mcp/resources files
- `abide:mcp`     — generated MCP server (createMcpServer)
- `abide:shell`   — app.html content (custom or default)
- `abide:app-info`    — { name, version } from package.json for OpenAPI info
- `abide:cli-manifest` — baked per-rpc manifest for the CLI binary
- `abide:cli-name`     — program name from package.json
- `abide:cli-chrome`   — banner/footer text from src/cli/
- `abide:bundle-window`               — optional bundle window config
- `abide:bundle-disconnected`         — baked connect-screen HTML
- `abide:bundle-disconnected-component` — connect-screen abide-ui component

Also rewrites modules under src/server/rpc and src/server/sockets:
- src/server/rpc/<file>.ts: each HTTP-method export is bound to a runtime
  implementation — defineRpc on the server, remoteProxy on the client.
- src/server/sockets/<file>.ts: each `socket(opts)` export is bound to
  defineSocket on the server (with the socket name + opts) or
  socketProxy on the client (name only — opts are server-side).
*/
// @documentation plumbing
export function abideResolverPlugin({
    cwd = process.cwd(),
    embedAssets = false,
    target = 'server',
}: {
    cwd?: string
    embedAssets?: boolean
    target?: 'server' | 'client'
} = {}): BunPlugin {
    const serverDir = `${cwd}/src/server`
    const uiDir = `${cwd}/src/ui`
    const sharedDir = `${cwd}/src/shared`
    const mcpDir = `${cwd}/src/mcp`
    const cliDir = `${cwd}/src/cli`
    const rpcDir = `${serverDir}/rpc`
    const socketsDir = `${serverDir}/sockets`
    const pagesDir = `${uiDir}/pages`
    const publicDir = `${uiDir}/public`
    const promptsDir = `${mcpDir}/prompts`
    const resourcesDir = `${mcpDir}/resources`

    /*
    The bare specifier the project imports abide under (canonical
    `abide` or a package alias). Resolved once from the project's
    package.json and threaded into every generated module so the codegen's
    imports resolve regardless of which install style the project uses.
    */
    const abideImportNameOnce = once(() => abideImportName(cwd))
    /*
    The whole-tree validation + per-leaf classification only needs to run
    once per build. Memoise the promise so the virtual manifests
    (rpc/sockets/pages/layouts) share a single scan instead of each one
    re-globbing the trees. The shell read is memoised the same way so two
    passes don't re-read app.html from disk.
    */
    const scanPagesOnce = once(() => scanPages(pagesDir))
    const scanRpcOnce = once(() => scanDir(rpcDir, '**/*.ts'))
    const scanSocketsOnce = once(() => scanDir(socketsDir, '**/*.ts'))
    /*
    Globs public/ once per build; the public-assets virtual reuses the returned
    list for its embed. (.d.ts codegen — publicAssets.d.ts and its siblings —
    moved to generateDeclarations, owned by build().)
    */
    const scanPublicOnce = once(async () =>
        existsSync(publicDir)
            ? await Array.fromAsync(new Glob('**/*').scan({ cwd: publicDir, onlyFiles: true }))
            : [],
    )
    const scanPromptsOnce = once(() => scanDir(promptsDir, '**/*.md'))
    const loadShellOnce = once(() => loadShell(cwd))
    /* Project package.json read once per build — three virtuals (cli-name,
       app-info, mcp identity) derive fields from it. */
    const readPackageJsonOnce = once(() => readPackageJson(cwd))

    const rpcFilter = new RegExp(`^${escapeRegex(rpcDir)}/.*\\.ts$`)
    const socketsFilter = new RegExp(`^${escapeRegex(socketsDir)}/.*\\.ts$`)
    const promptsFilter = new RegExp(`^${escapeRegex(promptsDir)}/.*\\.md$`)

    /*
    Side-crossing guard (client target only). The client bundle must never ship server-only
    code to the browser. A registered rpc/socket is the carve-out — `$server/rpc/*` and
    `$server/sockets/*` are replaced with remoteProxy/socketProxy stubs by the onLoad hooks —
    so a violation is a SURVIVING module under src/server/ that isn't one of those, or the
    public `abide/server/*` names.

    ADR-0022 D3 makes the project-server edge REACHABILITY-based rather than
    presence-at-resolve: the D2 client rpc transform keeps the real module (handler elided),
    so the elided handler's now-dead `$server/*` / `abide/server/*` imports are textually
    present until tree-shaking removes them. A resolve-time throw would false-positive on
    those. So the authority is a post-bundle `build.onEnd` pass that walks `metafile.inputs`
    (the DCE-accurate graph) and flags any server-only module that SURVIVED. The one guard
    that still fires at resolve is the public `abide/server/*` names reaching a genuine client
    module — those live in node_modules, outside `serverDir`, so the metafile classifier can't
    see them; the kept rpc module (proxied) is exempted so its dead handler imports don't
    reject before DCE.
    */
    const isProxiedServerModule = (path: string): boolean =>
        path.startsWith(`${rpcDir}/`) || path.startsWith(`${socketsDir}/`)
    const isServerOnlyModule = (path: string): boolean =>
        path.startsWith(`${serverDir}/`) && !isProxiedServerModule(path)
    const showPath = (path: string): string =>
        path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path
    /* Renders a root→offender absolute-path chain (from the bundle graph seam) as the cwd-relative
       `a\n  → b\n  → c` evidence the onEnd diagnostics print — the same shape the resolve-time guard
       gives. */
    const formatChain = (chain: string[]): string => chain.map(showPath).join('\n  → ')

    /* Warm per-root rpc server program (ADR-0025 D1). Lives in the setup closure so one build
       reuses a single `ts.Program` across every rpc transform (streaming/method queries);
       built lazily on the first rpc onLoad (so a build with no rpc modules never pays for it) and
       failing open to undefined, in which case each query stays on its char-scan/regex. (The
       rpc.d.ts codegen builds its own program in generateDeclarations, owned by build().) */
    const rpcServerByRoot = new Map<string, RpcServerProgram | undefined>()

    return {
        name: 'abide-resolver',
        setup(build) {
            /* Fresh edge graph + resolution cache each build (dev watch reuses the
               plugin instance). The resolution cache memoises (path → resolved file)
               within a build; clearing it per build keeps the memo but stops a stale
               miss — a path resolved before its file existed — surviving into the next
               build, so a freshly-created file resolves instead of staying "not found".
               onStart is build-time only — absent in the runtime/preload plugin context. */
            build.onStart?.(() => {
                resolveExtensionCache.clear()
            })

            /*
            Reachability-based side-crossing guard (client target, ADR-0022 D3). After the
            bundle is built, `metafile.inputs` is the post-DCE module graph: a textually-imported
            but tree-shaken module is ABSENT, a surviving one PRESENT. So walk it, flag any
            server-only module that survived (the elided rpc handler's dead `$server/*` imports
            are gone by now; a policy or page that LIVE-reaches server-only code is not), and on a
            hit reconstruct the import chain from the graph's own edges. This is the sole authority
            for the project-server edge — the resolve-time throw was relaxed so the kept rpc module
            can carry its handler's imports until DCE. metafile.inputs keys are relative to
            process.cwd(); edge `path`s are absolute — resolve both to absolute to match serverDir.
            */
            build.onEnd?.((result) => {
                if (target !== 'client' || !result.metafile) {
                    return
                }
                /* The post-DCE graph, walked once (ADR-0031 D2). Both consumers below read it — the
                   side-crossing guard and the bundle-budget diagnostic — instead of each re-walking
                   the metafile. */
                const graph = bundleGraphFromMetafile(result.metafile, process.cwd())

                /* Side-crossing guard (ADR-0022 D3): the FIRST surviving server-only module is a real
                   violation — throw with its import chain. The sole hard onEnd failure. */
                const offender = graph.modules.find((module) => isServerOnlyModule(module.path))
                if (offender !== undefined) {
                    throw new Error(
                        `[abide] a client module reaches the server-only name \`${showPath(offender.path)}\` — server code must not reach the browser bundle. Move it to src/shared/ or behind an RPC. Import chain:\n  ${formatChain(graph.importerChain(offender.path))}`,
                    )
                }

                /* Bundle-budget diagnostic (ADR-0031 D2), first consumer of the seam: a project src
                   module that survived DCE heavier than the budget earns a NON-BLOCKING warn with its
                   import chain — never fails the build. Scoped to files under cwd (excluding
                   node_modules) so the warning is about code the author owns and can act on. */
                for (const module of graph.modules) {
                    if (
                        module.bytes > CLIENT_BUNDLE_INPUT_BUDGET_BYTES &&
                        module.path.startsWith(`${cwd}/`) &&
                        !module.path.includes('/node_modules/')
                    ) {
                        abideLog.warn(
                            `client bundle input \`${showPath(module.path)}\` is ${(module.bytes / 1024).toFixed(1)} KiB (over the ${CLIENT_BUNDLE_INPUT_BUDGET_BYTES / 1024} KiB budget) — consider splitting or lazy-loading it. Import chain:\n  ${formatChain(graph.importerChain(module.path))}`,
                        )
                    }
                }
            })

            /*
            The public `abide/server/*` names are server-only and live in node_modules — outside
            `serverDir`, so the onEnd metafile classifier can't see them; this stays the resolve-time
            guard for them (the canonical `abide` and `@abide/abide` specifiers; a custom package
            alias falls through to the reachability guard). A genuine client module importing one is a
            side-crossing. The kept rpc/socket module (proxied) is EXEMPTED: the D2 client transform
            leaves its elided handler's `abide/server/*` imports textually present until DCE drops
            them, so rejecting here would false-positive. The server target resolves these normally.
            */
            build.onResolve({ filter: /(^|\/)abide\/server\// }, (args) => {
                if (
                    target === 'client' &&
                    args.importer &&
                    !isServerOnlyModule(args.importer) &&
                    !isProxiedServerModule(args.importer)
                ) {
                    throw new Error(
                        `[abide] a client module imports the server-only name \`${args.path}\` — server code must not reach the browser bundle. Move it to src/shared/ or behind an RPC. Import chain:\n  ${showPath(args.importer)}\n  → ${args.path}`,
                    )
                }
                return undefined
            })

            build.onResolve(
                {
                    filter: /\/_virtual\/(rpc|sockets|prompts|pages|layouts|app|config|mcp-resources|mcp|assets|public-assets|shell|app-info|cli-manifest|cli-name|cli-chrome|bundle-window|bundle-disconnected-component|bundle-disconnected)\.ts$/,
                },
                (args) => {
                    const name = fileStem(args.path)
                    if (!name) {
                        return undefined
                    }
                    return { path: `abide:${name}`, namespace: NS }
                },
            )

            /*
            User-facing aliases are the five top-level project directories.
            Sub-paths fall out of them: `$server/rpc/getThing`,
            `$ui/pages/...`, `$mcp/prompts/...`, `$mcp/resources/...`.
            `lib/` is userland — projects declare their own lib aliases.
            */
            const dirAliases: Record<string, string> = {
                $server: serverDir,
                $ui: uiDir,
                $shared: sharedDir,
                $mcp: mcpDir,
                $cli: cliDir,
            }
            for (const [alias, baseDir] of Object.entries(dirAliases)) {
                build.onResolve({ filter: new RegExp(`^\\${alias}(\\/.*)?$`) }, (args) => {
                    const subpath = args.path.slice(alias.length)
                    const resolved = resolveExtension(subpath ? `${baseDir}${subpath}` : baseDir)
                    /* No resolve-time side-crossing throw: a `$server/*` import that only the
                       elided rpc handler reaches is dead code DCE removes. Whether server-only
                       code actually survives into the client bundle is decided post-bundle by the
                       onEnd metafile reachability guard (ADR-0022 D3). */
                    return { path: resolved }
                })
            }

            /*
            Root-absolute url() references in stylesheets (e.g.
            `url(/fonts/x.woff2)`) point at files served from public/ at the
            site root at runtime, not at anything on disk at build time. Bun's
            CSS bundler otherwise tries to resolve them against the project
            root and fails the whole build. Mark them external so the literal
            `/…` path survives into the emitted CSS, where
            createPublicAssetServer serves it. Scoped to CSS importers: abide-ui
            <style> blocks compile to injected JS strings and never reach the
            CSS bundler, and abide's own absolute-path JS imports come from
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
                const importName = await abideImportNameOnce()
                /* Ask the warm server program for this handler's streaming verdict (return-type
                   query — a stream returned via a wrapper function is seen); undefined when no
                   program built or the node didn't resolve, so prepareRpcModule falls open to its
                   char-scan (ADR-0025 D2). */
                const rpcServerProgram = rpcServerForRoot(rpcServerByRoot, cwd, rpcDir)
                const streamingOverride = rpcServerProgram?.streamingForModule(args.path)
                /* The numeric/boolean input fields the server rewrite stamps as a `coerce` plan so
                   parseArgs turns a string query/form value into the typed value the schema
                   expects (ADR-0028). undefined (no program / unresolvable Args / no coercible
                   field) stamps no plan — a GET field stays a string, exactly as today. */
                const coercion = rpcServerProgram?.inputCoercionForModule(args.path)
                /* The handler's return type projected to JSON Schema, stamped as `outputJsonSchema` so
                   the runtime OpenAPI 200 / MCP outputSchema / inspector surface renders the real
                   response shape without an author-declared `schemas.output` (ADR-0030 D2). undefined
                   (no program / unprojectable body / an explicit override wins at runtime) stamps
                   nothing — the surface falls back to today's behavior. */
                const returnBodySchema = rpcServerProgram?.returnBodySchemaForModule(args.path)
                /* The handler's typed-error branches projected to a status-keyed JSON-Schema map,
                   stamped as `errorJsonSchemas` so the runtime OpenAPI surface documents each typed
                   error's status + data payload alongside the 200 (ADR-0030). undefined (no program /
                   no typed errors / unresolvable branch) stamps nothing — the surface omits the error
                   responses exactly as today. */
                const errorSchemas = rpcServerProgram?.errorSchemasForModule(args.path)
                /* The handler's structured success fields, baked onto the CLIENT stub as
                   `outputWirePlan` so the proxy revives a `Set`/`Map`/`bigint`/`Date` off a decoded
                   response the server encoded to honest JSON (ADR-0029 output path). undefined (no
                   program / unresolvable body / no structured field) bakes nothing — a response array
                   stays an array. */
                const outputWirePlan = rpcServerProgram?.outputWirePlanForModule(args.path)
                /* The handler's input args projected to JSON Schema, stamped as `inputJsonSchema` so the
                   runtime OpenAPI parameters/body / MCP inputSchema / inspector input surface renders the
                   real input shape (and the endpoint becomes advertisable) without an author-declared
                   `schemas.input` — mirroring the `outputJsonSchema` output-side path (ADR-0030). A
                   declared `schemas.input` VALIDATOR still overrides it at runtime. undefined (no program
                   / unresolvable Args / File-only body) stamps nothing — the surface behaves as today. */
                const inputSchema = rpcServerProgram?.inputSchemaForModule(args.path)
                const prepared = prepareRpcModule(
                    source,
                    importName,
                    streamingOverride,
                    coercion,
                    returnBodySchema,
                    errorSchemas,
                    outputWirePlan,
                    inputSchema,
                )
                if (!prepared) {
                    throw new Error(
                        `[abide] src/server/rpc/${relativePath} has no \`export const <name> = <METHOD>(...)\` — every $rpc module must declare exactly one remote function`,
                    )
                }
                const expectedName = fileStem(relativePath)
                if (prepared.exportName !== expectedName) {
                    throw new Error(
                        `[abide] src/server/rpc/${relativePath} exports \`${prepared.exportName}\` but the filename expects \`${expectedName}\` — the export name must match the file's stem`,
                    )
                }
                /*
                Client bundle: keep the real module but swap the METHOD( call for a remoteProxy(
                call with the handler ELIDED (ADR-0022 D2), symmetric with the server rewrite
                below. The handler body and the top-level imports only it used become dead code the
                bundler tree-shakes out; the endpoint `opts` (schemas/cache/stream) rides through as
                a LIVE expression, so policy can reference imports and separate modules. The
                surviving-server-module reachability guard (build.onEnd) is the authority that no
                server-only code leaks — resolve-time presence of the elided handler's imports is no
                longer a violation.
                */
                if (target === 'client') {
                    const banner = `import { remoteProxy as ${REMOTE_PROXY_GLOBAL} } from '${importName}/ui/remoteProxy';
`
                    return {
                        contents: `${banner}${prepared.rewriteForClient(url)}`,
                        loader: 'ts',
                    }
                }
                /*
                Server target: strip the user's rpc import, then rewrite
                the `<METHOD>(` call so the method (from the identifier) and
                the URL (from the file path) are threaded into the
                runtime constructor — defineRpc. The user's handler body
                stays intact between the parens; any generics on the call
                are dropped (they carry no runtime info). Rewriting is
                tokenizer-driven so `GET` mentions inside strings and
                comments are left alone.
                */
                const banner = `import { defineRpc as ${DEFINE_RPC_GLOBAL} } from '${importName}/server/rpc/defineRpc';
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
                const importName = await abideImportNameOnce()
                const prepared = prepareSocketModule(source, importName)
                if (!prepared) {
                    throw new Error(
                        `[abide] src/server/sockets/${relativePath} has no \`export const <name> = socket(...)\` — every $sockets module must declare exactly one socket`,
                    )
                }
                const expectedName = fileStem(relativePath)
                if (prepared.exportName !== expectedName) {
                    throw new Error(
                        `[abide] src/server/sockets/${relativePath} exports \`${prepared.exportName}\` but the filename expects \`${expectedName}\` — the export name must match the file's stem`,
                    )
                }
                if (target === 'client') {
                    /*
                    Client bundle gets a name-only stub — opts (tail,
                    clientPublish) are server-side state and don't
                    affect the client's wire behaviour.
                    */
                    const contents = `import { socketProxy as __abideSocketProxy__ } from '${importName}/ui/socketProxy';
export const ${prepared.exportName} = __abideSocketProxy__(${JSON.stringify(name)});
`
                    return { contents, loader: 'ts' }
                }
                const banner = `import { defineSocket as ${DEFINE_SOCKET_GLOBAL} } from '${importName}/server/sockets/defineSocket';
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
                const importName = await abideImportNameOnce()
                const parsed = parsePromptMarkdown(source)
                const jsonSchema = jsonSchemaForPromptArguments(parsed.arguments)
                const optionLines = [
                    parsed.description
                        ? `    description: ${JSON.stringify(parsed.description)},`
                        : undefined,
                    jsonSchema ? `    jsonSchema: ${JSON.stringify(jsonSchema)},` : undefined,
                    `    render: (args) => __abideRenderPromptTemplate__(__template__, args),`,
                ]
                    .filter((line) => line !== undefined)
                    .join('\n')
                const contents = `import { definePrompt as __abideDefinePrompt__ } from '${importName}/server/prompts/definePrompt'
import { renderPromptTemplate as __abideRenderPromptTemplate__ } from '${importName}/server/prompts/renderPromptTemplate'
const __template__ = ${JSON.stringify(parsed.body)}
export const prompt = __abideDefinePrompt__(${JSON.stringify(name)}, {
${optionLines}
})
`
                return { contents, loader: 'ts' }
            })

            build.onLoad({ filter: /.*/, namespace: NS }, async (args) => {
                if (args.path === 'abide:rpc') {
                    return manifestModule({
                        files: await scanRpcOnce(),
                        keyForFile: rpcUrlForFile,
                        importDir: rpcDir,
                        exportName: 'rpc',
                    })
                }

                if (args.path === 'abide:sockets') {
                    return manifestModule({
                        files: await scanSocketsOnce(),
                        keyForFile: socketNameForFile,
                        importDir: socketsDir,
                        exportName: 'sockets',
                    })
                }

                if (args.path === 'abide:prompts') {
                    return manifestModule({
                        files: await scanPromptsOnce(),
                        keyForFile: promptNameForFile,
                        importDir: promptsDir,
                        exportName: 'prompts',
                        label: 'prompt modules',
                    })
                }

                if (args.path === 'abide:pages') {
                    const { pageFiles } = await scanPagesOnce()
                    return manifestModule({
                        files: pageFiles,
                        keyForFile: pageUrlForFile,
                        importDir: pagesDir,
                        exportName: 'pages',
                    })
                }

                if (args.path === 'abide:layouts') {
                    const { layoutFiles } = await scanPagesOnce()
                    return manifestModule({
                        files: layoutFiles,
                        keyForFile: pageUrlForFile,
                        importDir: pagesDir,
                        exportName: 'layouts',
                    })
                }

                if (args.path === 'abide:app') {
                    const userApp = `${cwd}/src/app.ts`
                    const hasAppModule = await Bun.file(userApp).exists()
                    if (hasAppModule) {
                        abideLog.info('using custom src/app.ts')
                        return {
                            contents: `export * from ${JSON.stringify(userApp)}`,
                            loader: 'js',
                        }
                    }
                    return { contents: 'export {};', loader: 'js' }
                }

                if (args.path === 'abide:config') {
                    /*
                    Re-exports src/server/config.ts so serverEntry can eager-import
                    it at boot — running its `env(schema)` validation once the env
                    layers are merged, before the server starts. Optional: an empty
                    stub when absent, so an app with no config builds and boots the
                    same (it just reads Bun.env directly).
                    */
                    const userConfig = `${serverDir}/config.ts`
                    if (await Bun.file(userConfig).exists()) {
                        abideLog.info('using src/server/config.ts')
                        return {
                            contents: `export * from ${JSON.stringify(userConfig)}`,
                            loader: 'js',
                        }
                    }
                    return { contents: 'export {};', loader: 'js' }
                }

                if (args.path === 'abide:cli-manifest') {
                    /*
                    The CLI binary's bake-time manifest. Discovery (a
                    one-shot script the bundler runs separately) writes
                    `${cwd}/dist/cli-manifest.json` from the populated
                    rpcRegistry; this virtual splices that JSON in as a
                    default-exported object. Empty manifest when the
                    discovery file is missing — the binary still works
                    but exposes no subcommands until the user runs the
                    full `abide cli` flow.
                    */
                    const manifestPath = `${cwd}/dist/cli-manifest.json`
                    if (!existsSync(manifestPath)) {
                        return { contents: 'export default {}', loader: 'js' }
                    }
                    const json = await Bun.file(manifestPath).text()
                    return { contents: `export default ${json}`, loader: 'js' }
                }

                if (args.path === 'abide:cli-name') {
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

                if (args.path === 'abide:bundle-window') {
                    /*
                    Optional bundle window config (title/size/menu) baked into
                    the bundled launcher. Re-exports the default from
                    src/bundle/window.ts when present; otherwise an empty
                    object so the launcher falls back to its defaults.
                    */
                    const userFile = `${cwd}/src/bundle/window.ts`
                    if (existsSync(userFile)) {
                        abideLog.info('using custom src/bundle/window.ts')
                        return {
                            contents: `export { default } from ${JSON.stringify(userFile)}`,
                            loader: 'js',
                        }
                    }
                    return { contents: 'export default {}', loader: 'js' }
                }

                if (args.path === 'abide:bundle-disconnected') {
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
                            '<!doctype html><html><body><div id="app">abide</div></body></html>'
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

                if (args.path === 'abide:bundle-disconnected-component') {
                    /*
                    The abide-ui component the connect-screen build mounts: the project's
                    src/bundle/disconnected.abide override when present, otherwise the lib
                    default. Re-exports the default like abide:bundle-window; the abide-ui
                    `.abide` loader compiles the target either way.
                    */
                    const userFile = `${cwd}/src/bundle/disconnected.abide`
                    if (existsSync(userFile)) {
                        abideLog.info('using custom src/bundle/disconnected.abide')
                        return {
                            contents: `export { default } from ${JSON.stringify(userFile)}`,
                            loader: 'js',
                        }
                    }
                    const defaultFile = new URL('./lib/bundle/disconnected.abide', import.meta.url)
                        .pathname
                    return {
                        contents: `export { default } from ${JSON.stringify(defaultFile)}`,
                        loader: 'js',
                    }
                }

                if (args.path === 'abide:cli-chrome') {
                    /*
                    Optional CLI help chrome baked into the binary: src/cli/
                    banner.txt prints atop top-level help, footer.txt prints
                    below it. Missing files emit empty strings (no chrome).
                    Read as plain text, like abide:shell.
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

                if (args.path === 'abide:app-info') {
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

                if (args.path === 'abide:mcp') {
                    /*
                    The MCP server is fully framework-generated — tools from
                    the rpc registry, prompts from src/mcp/prompts, resources
                    from src/mcp/resources. createMcpServer is internal; there
                    is no user-authored server module. Server identity comes
                    from package.json so the `mcp__<name>__*` permission prefix
                    is stable and app-specific; absent a name, createMcpServer
                    falls back to its own default.
                    */
                    const importName = await abideImportNameOnce()
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

                if (args.path === 'abide:assets') {
                    if (!embedAssets) {
                        return { contents: 'export const assets = undefined', loader: 'js' }
                    }
                    const appDir = `${cwd}/dist/_app`
                    const files = await Array.fromAsync(
                        new Glob('**/*.gz').scan({ cwd: appDir, onlyFiles: true }),
                    )
                    const contents = await embedGzipDir({
                        dir: appDir,
                        files,
                        keyFor: (file) => `/_app/${file.replace(/\.gz$/, '')}`,
                        precompressed: true,
                        exportName: 'assets',
                        label: 'gzip assets',
                        source: 'dist/_app/',
                    })
                    return { contents, loader: 'js' }
                }

                if (args.path === 'abide:public-assets') {
                    /*
                    Embeds every file under public/ (gzip level 9, paid
                    once at compile) keyed by its site-root path so the
                    standalone binary serves them without a public/ dir on
                    disk. Mirrors abide:assets. Empty/undefined when not
                    embedding (dev + `abide start` read public/ off disk).
                    */
                    // Globs public/ and writes publicAssets.d.ts every build; reuse the list to embed.
                    const files = await scanPublicOnce()
                    if (!embedAssets || files.length === 0) {
                        return {
                            contents: 'export const publicAssets = undefined',
                            loader: 'js',
                        }
                    }
                    const contents = await embedGzipDir({
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

                if (args.path === 'abide:mcp-resources') {
                    /*
                    Embeds every file under src/mcp/resources/ (gzip level
                    9) keyed by its path relative to that dir, so the
                    standalone binary serves MCP resources without the folder
                    on disk. Mirrors abide:public-assets. Undefined when not
                    embedding (dev + `abide start` read off disk).
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
                    const contents = await embedGzipDir({
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

                if (args.path === 'abide:shell') {
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
Encodes every file in `files` (relative to `dir`) into a base64 gzip map and
emits `export const <exportName> = { "<key>": _d("<base64>") }`. `keyFor` maps
a relative path to its lookup key; `precompressed` true means the files are
already `.gz` on disk (read + base64 as-is), false means compress here at
level 9. Shared by the abide:assets / abide:public-assets / abide:mcp-resources
virtuals, which differ only in source dir, key shape, and whether the inputs
are pre-compressed.
*/
async function embedGzipDir({
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
            const bytes = precompressed ? raw : Bun.gzipSync(raw, { level: 9 })
            return {
                line: `    ${JSON.stringify(keyFor(file))}: _d(${JSON.stringify(bytes.toBase64())}),`,
                bytes: bytes.byteLength,
            }
        }),
    )
    const totalBytes = encoded.reduce((total, entry) => total + entry.bytes, 0)
    const unit = precompressed ? 'KiB' : 'KiB gzip'
    abideLog.info(
        `embedded ${encoded.length} ${label} from ${source} (${(totalBytes / 1024).toFixed(1)} ${unit})`,
    )
    return `const _d = (s) => Uint8Array.fromBase64(s)
export const ${exportName} = {
${encoded.map((entry) => entry.line).join('\n')}
}
`
}

/*
Walks one registry directory once: src/server/rpc (every `.ts` file is an
HTTP-method rpc handler), src/server/sockets (each `.ts` file declares one
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
Picks `src/ui/app.html` when it exists, otherwise the bundled default
shell. Reads the file once per build so the resolver's two virtual passes share
a single disk hit. Rewrites the literal `/_app/client.js` and `/_app/client.css`
references to the hashed entry filenames emitted by the client build so the
entry bundles can be served with `immutable` cache headers like the chunks.
*/
async function loadShell(cwd: string): Promise<string> {
    const userShell = `${cwd}/src/ui/app.html`
    const defaultShell = new URL('./assets/app.html', import.meta.url).pathname
    const filepath = (await Bun.file(userShell).exists()) ? userShell : defaultShell
    if (filepath === userShell) {
        abideLog.info('using custom src/ui/app.html')
    }
    const content = await Bun.file(filepath).text()
    return await rewriteHashedClientEntries(injectShellAssets(content), cwd)
}

/*
Injects the framework's client entry references so app.html stays a clean
template — page structure plus the SSR markers, no framework asset bookkeeping.
The css <link> and the entry's <link rel="modulepreload"> land before </head>,
the module <script> before </body>. Each is skipped when the shell already
carries that reference, so a custom app.html that still spells the tags out (or
one already processed) doesn't get a duplicate. rewriteHashedClientEntries then
swaps every reference for the hashed entry filenames.

The modulepreload makes the browser fetch the entry during a streamed render —
the closing </body> <script> tag arrives only after the whole stream, so without
it the entry download is serialized after the body. Execution still defers to
parse-end (module script), so hydration ordering is unchanged; only the transfer
overlaps the stream.
*/
function injectShellAssets(shell: string): string {
    let result = shell
    if (!result.includes('/_app/client.css')) {
        result = injectBeforeTag(
            result,
            '<link rel="stylesheet" href="/_app/client.css" />',
            'head',
            'src/ui/app.html has no </head>',
        )
    }
    if (!result.includes('rel="modulepreload"')) {
        result = injectBeforeTag(
            result,
            '<link rel="modulepreload" href="/_app/client.js" />',
            'head',
            'src/ui/app.html has no </head>',
        )
    }
    // Guard on `src=` so the modulepreload's matching href doesn't mask a missing <script>.
    if (!result.includes('src="/_app/client.js"')) {
        result = injectBeforeTag(
            result,
            '<script type="module" src="/_app/client.js"></script>',
            'body',
            'src/ui/app.html has no </body>',
        )
    }
    return result
}

/*
Inserts `snippet` before the shell's closing `</tag>` (case-insensitive, so an
uppercase or oddly-cased custom app.html still works). When the tag is absent
the asset would otherwise be silently dropped, leaving the page unstyled /
unhydrated; instead warn and append the snippet so it still ships.
*/
function injectBeforeTag(
    shell: string,
    snippet: string,
    tag: 'head' | 'body',
    missingMessage: string,
): string {
    const closing = new RegExp(`</${tag}\\s*>`, 'i')
    if (closing.test(shell)) {
        return shell.replace(closing, (match) => `${snippet}\n${match}`)
    }
    abideLog.warn(`${missingMessage} — appending the reference at the end of the document`)
    return `${shell}\n${snippet}`
}

/*
Scans the client-bundle directory for the hashed client entry filenames produced
by build.ts (e.g. `client-abc12345.js`, `client-abc12345.css`) and swaps the
shell's literal `/_app/client.js` and `/_app/client.css` references for them. The
js reference appears twice (the modulepreload <link> and the entry <script>), so
replaceAll covers both. When the directory is missing (someone running the server
before a build) the shell is returned unchanged so the existing broken-asset
behaviour is preserved.

The directory is `dist/_app` for a production build, but under `abide dev` the
orchestrator serves each build generation from its own `_app.gen-<id>` dir and
passes it as `ABIDE_APP_DIR` (this runs in the worker, which resolves `abide:shell`
at boot). Reading that env keeps the shell's entry ref, the preload manifest, and
the asset server all pointed at the one generation this worker owns — never a
sibling generation a concurrent worker is serving. Each generation dir holds
exactly one entry, so `.find` is unambiguous.
*/
async function rewriteHashedClientEntries(shell: string, cwd: string): Promise<string> {
    const appDir = process.env.ABIDE_APP_DIR ?? `${cwd}/dist/_app`
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
        result = result.replaceAll('/_app/client.js', `/_app/${jsEntry}`)
        result = await injectEntryDepPreloads(result, `${appDir}/${jsEntry}`)
    }
    if (cssEntry) {
        result = result.replace('/_app/client.css', `/_app/${cssEntry}`)
    }
    return result
}

/* Static-import specifiers in the built entry: `import {…} from "./chunk.js"` and
   side-effect `import "./chunk.js"`, minified (no spaces) or not. The leading
   `import` plus the `[^"'()]` guard excludes dynamic `import("./page-….js")`, so
   only the runtime graph matches — route chunks stay lazy. */
const ENTRY_STATIC_IMPORT = /import\s*(?:[^"'()]*?\bfrom\s*)?["']\.\/([\w.-]+\.js)["']/g

/*
SPIKE: preload the entry's static dependency chunks. The entry <script> statically
imports the abide-ui runtime as ~60 one-export `clientEntry-<hash>.js` chunks; the
browser can't discover them until it has downloaded and PARSED the entry, which on a
streamed page is ~stream-close — so the runtime waterfalls in a second wave after the
body finishes. Emitting a <link rel="modulepreload"> for each static dep into <head>
lets the whole graph transfer DURING the stream alongside the entry, so hydration is
network-ready at stream-close instead of after it. Route chunks (`import("./page-…")`)
are dynamic, so they don't match and stay lazy — code-splitting still pays off.
*/
async function injectEntryDepPreloads(shell: string, entryPath: string): Promise<string> {
    const source = await Bun.file(entryPath).text()
    const deps = [...new Set([...source.matchAll(ENTRY_STATIC_IMPORT)].map((match) => match[1]))]
    if (deps.length === 0) {
        return shell
    }
    const links = deps.map((dep) => `<link rel="modulepreload" href="/_app/${dep}" />`).join('\n')
    return injectBeforeTag(shell, links, 'head', 'src/ui/app.html has no </head>')
}
