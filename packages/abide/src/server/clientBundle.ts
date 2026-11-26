// 38.5, 38.16 — THE CLIENT BUNDLE, for both lanes that build one: `abide build`, which writes it to
// disk for `abide start`, and `abide dev`'s worker, which holds it in memory. What decides what the
// bundle IS — its plugins and their order, whether there is a page to boot, how a stylesheet's
// addresses are written, the manifest — is here once, so dev resolves an address the way the
// built app does by construction; a lane picks only a `mode`. And both answer it at
// `/__abide/client/<name>` through `bundleServer`, differing in where a byte is read from and how
// long a browser may keep it.

import { CLIENT_ADDRESS } from '#shared/ADDRESSES.ts'

import {
    abideModules,
    type Compilation,
    tablePath,
    workerFilesOf,
    workerFilesPlugin,
    type WorkerSpawn,
} from './abideModules.ts'
import { appPlugins } from './appPlugins.ts'
import { CLIENT_ENTRY } from './CLIENT_BUILD.ts'
import { fenceServer } from './fenceServer.ts'
import { type Manifest, manifestOf, NO_MANIFEST } from './manifestOf.ts'
import { HANDLER_SUFFIX } from './MODULE_QUERIES.ts'
import { type Encoding, negotiateEncoding } from './negotiateEncoding.ts'
import { workerBundles } from './workerBundles.ts'

/** One file the bundle produced: its bytes — a stylesheet's already rewritten — and its kind. */
type BundledFile = {
    bytes: Uint8Array<ArrayBuffer>
    type: string
    kind: Bun.BuildArtifact['kind']
}

/** A client bundle: every file it produced, by its name below `/__abide/client`, and its manifest. */
export type ClientBundle = {
    files: Map<string, BundledFile>
    manifest: Manifest
}

/**
 * The client bundle of the app at `root`, out of `compilation`, built for `mode`.
 *
 * `published` is each public file's source path to its address. `'build'` is 38.5's — minified and
 * every name hashed; `'dev'` is 38.16's — unminified, the entry named by its source, with linked
 * maps. A bundle that fails throws, its logs the error's.
 *
 * AN APP OF HANDLERS ALONE has no page to boot, and is bundled as nothing with no manifest.
 */
export async function clientBundle(
    root: string,
    compilation: Compilation,
    published: Map<string, string>,
    mode: 'build' | 'dev',
): Promise<ClientBundle> {
    const bundle: ClientBundle = { files: new Map(), manifest: NO_MANIFEST }
    // A page among what compiled: the compiler writes the entry only where there is one to boot.
    if (compilation.tables[`${CLIENT_ENTRY}.ts`] === undefined) return bundle
    // Every file the bundle produced: each thread's a page starts (55.1), then the pages'.
    const outputs: Bun.BuildArtifact[] = []
    const config = {
        // 16.28, 16.29 — the browser's view of the server: a `<script server>` is its stand-ins and a
        // server file refuses — FENCED FIRST, before the plugin that would serve the module. 38.43
        // — then the app's own, as `bunfig.toml` declares them.
        plugins: [
            fenceServer(root),
            abideModules(root, compilation),
            ...(await appPlugins(root)),
        ],
        target: 'browser',
        format: 'esm',
        // 36.15 — a stylesheet's `url('/fonts/…')` is the public file's address, not a path here,
        // and `Bun.build` reads a leading `/` as a path on this disk and fails on it not being
        // there. The list is the files that exist rather than every `/…`: a URL naming nothing the
        // app serves is still worth a build error.
        external: [...published.values()],
        // 36.16 — THE MODE, NOT THE ENVIRONMENT: the bundler writes in the `NODE_ENV` this process
        // STARTED under, so the `production` `abide build` assigns once running never reached it.
        define: {
            'process.env.NODE_ENV': JSON.stringify(
                mode === 'build' ? 'production' : 'development',
            ),
        },
        ...(mode === 'build'
            ? {
                  // NAMES KEPT, because a class's name is what an error reads to say what it was
                  // handed (`canonicalKey`), and a production error naming `a e` is one nobody can
                  // act on. It is free where it is paid: the JS the docs app's `/values` sends is
                  // 25 600 bytes brotli with the names and without, against 31 900 unminified.
                  minify: {
                      whitespace: true,
                      syntax: true,
                      identifiers: true,
                      keepNames: true,
                  },
              }
            : {
                  // 38.97 — a debugger in the browser reads the `.abide` (`withAbideSources`).
                  sourcemap: 'linked' as const,
              }),
    } satisfies Parameters<typeof workerBundles>[2]
    const pages = (spawn: WorkerSpawn) =>
        Bun.build({
            ...config,
            // The entry is a table the plugin serves (`abideModules`), below the root.
            entrypoints: [tablePath(root, `${CLIENT_ENTRY}.ts`)],
            // The app's own root, because `Bun.build` opens the entry's directory otherwise, and the
            // tables' is not on disk to open.
            root,
            // 55.1 — after the fence, so a worker file importing a server file still refuses.
            plugins: [
                ...config.plugins,
                workerFilesPlugin(
                    root,
                    workerFilesOf(root, compilation),
                    spawn,
                ),
            ],
            // So a destination's markup and bindings stay in the chunk its own route loads (30.11)
            // rather than landing in the entry every page pays for.
            splitting: true,
            metafile: true,
            throw: false,
            naming:
                mode === 'build'
                    ? // 38.5 — EVERY NAME HASHED, the entry's included: chunks and assets are
                      // already `[name]-[hash]` by default and the entry is not, which left the one
                      // file every page loads served for a year under a name the next deploy writes
                      // different bytes to. The manifest is how the document learns what the entry
                      // was called.
                      { entry: '[name]-[hash].[ext]' }
                    : // 38.16 — the entry named by its source, so what a browser loads and what a
                      // stack trace names are the module the author wrote. A dev chunk that changed
                      // has to be fetched again, and a name that changes with it is a cache the
                      // reload cannot clear.
                      {
                          entry: '[name].[ext]',
                          chunk: '[name]-[hash].[ext]',
                          asset: '[name]-[hash].[ext]',
                      },
        })
    // 55.13 — ONLY THE WORKER FILES A PAGE REACHES ARE BUILT FOR THE BROWSER: a worker file the server
    // alone imports may import a server file. The first build finds them; where it found any, they
    // are built and the pages again, now naming what each was written under — so a page's hashed
    // name moves with every worker it starts.
    const reached = new Set<string>()
    let built = await pages((path) => {
        reached.add(path)
        return '() => undefined'
    })
    if (built.success && reached.size !== 0) {
        const threads = await workerBundles(root, [...reached], config)
        outputs.push(...threads.outputs)
        built = await pages(
            (path) =>
                `() => new Worker(new URL(${JSON.stringify(`./${threads.names.get(path)}`)}, import.meta.url), { type: 'module' })`,
        )
    }
    // THROWN RATHER THAN LOGGED: a build that emitted server modules and no bundle is an app that
    // serves every page dead — the markup right and nothing wired — which is the one failure a
    // reader cannot see. Dev catches it (38.17); the build stops on it.
    if (!built.success) {
        const fenced = serverExportImported(built.logs)
        if (fenced !== undefined) throw new Error(fenced)
        throw new AggregateError(
            built.logs,
            `abide ${mode}: the client bundle failed`,
        )
    }
    outputs.push(...built.outputs)
    // The outputs are independent, so they are read at once rather than one after another.
    const read = await Promise.all(
        outputs.map((output) => output.arrayBuffer()),
    )
    for (let index = 0; index < outputs.length; index += 1) {
        const output = outputs[index] as Bun.BuildArtifact
        const name = output.path.slice(output.path.lastIndexOf('/') + 1)
        let bytes = new Uint8Array(read[index] as ArrayBuffer)
        if (name.endsWith('.css'))
            bytes = new TextEncoder().encode(
                stylesheetUnderMount(new TextDecoder().decode(bytes)),
            )
        bundle.files.set(name, { bytes, type: output.type, kind: output.kind })
    }
    bundle.manifest = manifestOf(built.metafile as Bun.BuildMetafile, root)
    return bundle
}

// From the bundle's own directory up to the app's root: `../../` below `/__abide/client`.
const UP_TO_ROOT = '../'.repeat(CLIENT_ADDRESS.split('/').length - 1)

/**
 * A built stylesheet with every root-absolute `url()` written relative to the bundle's directory.
 *
 * 16.10, 36.15 — THE SAME MECHANISM AS THE HANDLER WRAPPERS: the address is written relative to
 * where the bundle is served and the browser resolves it against the sheet, so one build serves
 * at the root and below a mount. What survives the build as `url(/…)` is a public file's address
 * (the `external` list above), and the browser would resolve it against the origin. `//` is
 * another host's.
 */
function stylesheetUnderMount(css: string): string {
    return css.replace(
        /url\((["']?)\/(?!\/)/g,
        (_whole, quote: string) => `url(${quote}${UP_TO_ROOT}`,
    )
}

/** A bundle file as it is answered: its type, its bytes, and each precompressed copy of them. */
export type ServedFile = {
    type: string
    body: () => BodyInit
    encoded: Partial<Record<Encoding, () => BodyInit>>
}

/**
 * Answers `/__abide/client/<name>` out of `files`, each with `cacheControl`; `undefined` for any
 * other address, and for a name the bundle does not hold.
 *
 * THE BUNDLE, ENUMERATED RATHER THAN RESOLVED. A request names a file in this set or it names
 * nothing — there is no path to normalize, so `..` is not a case that has to be got right, and what
 * is servable is exactly what the bundle produced.
 */
export function bundleServer(
    files: Map<string, ServedFile>,
    cacheControl: string,
): (pathname: string, request: Request) => Response | undefined {
    // Each file's encodings listed once, rather than on every request for it.
    const offeredOf = new Map<string, Encoding[]>()
    for (const [name, file] of files)
        offeredOf.set(name, Object.keys(file.encoded) as Encoding[])
    return (pathname, request) => {
        if (!pathname.startsWith(`${CLIENT_ADDRESS}/`)) return undefined
        const name = pathname.slice(CLIENT_ADDRESS.length + 1)
        const file = files.get(name)
        if (file === undefined) return undefined
        const headers: Record<string, string> = {
            'cache-control': cacheControl,
            'content-type': file.type,
        }
        const offered = offeredOf.get(name) as Encoding[]
        if (offered.length === 0) return new Response(file.body(), { headers })
        headers.vary = 'accept-encoding'
        // 38.29 — the precompressed copy where the request takes its encoding.
        const encoding = negotiateEncoding(
            request.headers.get('accept-encoding'),
            offered,
        )
        const encoded =
            encoding === undefined ? undefined : file.encoded[encoding]
        if (encoding === undefined || encoded === undefined)
            return new Response(file.body(), { headers })
        headers['content-encoding'] = encoding
        return new Response(encoded(), { headers })
    }
}

/**
 * 16.29 — the refusal of a browser import of a server file's export that is no `rpc`: the file crosses
 * as its `rpc`s' wrappers (16.74), so the bundler meets a name its face does not export, and says so
 * in its own words. Said in abide's, naming the file and the export, where a log is that one.
 */
function serverExportImported(
    logs: Bun.BuildOutput['logs'],
): string | undefined {
    for (const log of logs) {
        const found = SERVER_EXPORT_MISSING.exec(log.message)
        if (found === null) continue
        const [, file, name] = found
        return `abide: the browser's bundle imports ${JSON.stringify(name)} from ${file}, a server file whose exports reach the browser only as its \`rpc\`s. Export it as one, or import it on the server alone. RULEBOOK 16.29.`
    }
    return undefined
}

/** The bundler's word for an import its face does not export: the file, and the name asked. */
const SERVER_EXPORT_MISSING = new RegExp(
    `No matching export in "([^"]*\\.server\\.[^"/]*?)(?:${RegExp.escape(HANDLER_SUFFIX)})?" for import "([^"]+)"`,
)
