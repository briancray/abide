// The server lane an app did not write — generated from the same four conventions a boot reads, and
// compiled into a standalone executable.
//
// This is `entry.ts`'s twin, and the reason is the same one stated there: a table that is already on
// disk has to be retyped for a substrate that cannot read a disk. There, the substrate is a browser
// and the table is the routes. Here, the substrate is a BINARY — `bun build --compile` writes one
// file, and inside it there is no `src/server/rpc/` to glob, no `src/ui/pages/` to walk, no
// `app.html` to read and no `.abide/client/` to serve out of. So every one of those questions is
// asked HERE, at compile time, where the tree still is, and the answers become static imports.
//
// Which means the emitted text is a TABLE rather than a program. Nothing in it decides anything: the
// transport modules are imported for the side effect that registers them, the pages become one
// `import()` thunk per file exactly as the client lane's do, `app.html` is inlined as the text it
// is, and every built asset and public file is imported `with { type: 'file' }` — Bun's own spelling
// for "put these bytes in the executable", which come back as paths `Bun.file` reads. What to DO
// with all of it is `binary()`'s, on the framework side, so this file cannot be where the two
// assemblies drift apart.
//
// Written into `.abide/` for the three reasons the client lane is: it is a build artifact, the
// directory is already gitignored, and the watcher already ignores it.

// `node:path` stands in for nothing: Bun ships no path api, and the builtin IS the supported one.
import { dirname, relative } from 'node:path'
import { APP_HTML, APP_MODULES, PUBLIC_DIR } from '#compiler/LAYOUT.ts'
import { type PageFiles, pageFiles } from '#server/pages.ts'
import {
    BINARY_ENTRY,
    CLIENT_DIR,
    type ClientAsset,
    type ClientManifest,
    firstPresent,
    PAGES,
} from '../CLIENT_BUILD.ts'
import { transportFiles } from './handlers.ts'
import { publicNames } from './publics.ts'

/** The entry, and what it ended up naming — which is the line `abide compile` prints. */
export interface BinaryLane {
    path: string
    endpoints: number
    pages: number
    assets: number
    publics: number
    /** The app's own module, or `null` — the same fact `report` prints after a bind. */
    entry: string | null
}

/**
 * The lane at `root`, written from the app's own tree.
 *
 * `manifest` is what `abide build` just wrote, or `null` for an app with no client lane at all — an
 * app made of endpoints, which is a whole and ordinary thing for a binary to be.
 */
export async function binaryLane(
    root: string,
    manifest: ClientManifest | null,
    name: string,
): Promise<BinaryLane> {
    const entry = await firstPresent(root, APP_MODULES)
    const transports = await transportFiles(root, false)
    const table = (await pageFiles(`${root}/${PAGES}`).catch((): PageFiles[] => [])).sort((a, b) =>
        a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    )
    const publics = await publicNames(root).catch((): string[] => [])
    // Only when there are pages to render into it: an app made of endpoints has no document, and
    // reading one it does not have would be a compile that fails on a file nobody wrote.
    const html =
        table.length === 0
            ? null
            : await Bun.file(`${root}/${APP_HTML}`)
                  .text()
                  .catch(() => null)

    // The app entry as the generated file has to name it, resolved once: the same string is what the
    // lane REPORTS, and two `relative` calls are two answers to one question.
    const local = entry === null ? null : relative(root, entry)
    const path = `${root}/${BINARY_ENTRY}`
    await Bun.write(path, source(local, transports, table, publics, html, manifest, name))
    return {
        path,
        entry: local,
        endpoints: transports.length,
        pages: table.length,
        assets: manifest === null ? 0 : Object.keys(manifest.assets).length,
        publics: publics.length,
    }
}

/**
 * The lane, as text.
 *
 * The imports are `abide/cli` — the app's own dependency by its PUBLIC specifier, resolved from
 * `.abide/` upward like any other module here. A relative path into the framework would resolve past
 * the app's `exports` map and bundle a private file.
 */
function source(
    entry: string | null,
    transports: string[],
    table: PageFiles[],
    publics: string[],
    html: string | null,
    manifest: ClientManifest | null,
    name: string,
): string {
    let text = HEADER

    text += "import { binary } from 'abide/cli'\n"
    if (entry !== null) text += `import * as app from ${quoted(entry)}\n`
    // For the side effect, which IS the registration: the compiler appends a `register(…)` to every
    // transport module, so importing one is what puts its address in the registry.
    for (const module of transports) text += `import ${quoted(module)}\n`

    // One thunk per FILE, not per file per page: a root layout is above every route in the table, and
    // a fresh `() => import(…)` per row would be N modules nothing can see are one.
    const named = new Map<string, string>()
    let loaders = ''
    for (const row of table) {
        for (const file of [...row.layouts, row.page]) {
            if (named.has(file)) continue
            const local = `view${named.size}`
            named.set(file, local)
            loaders += `const ${local} = (): Promise<ViewModule> => import(${quoted(`${PAGES}/${file}`)})\n`
        }
    }
    if (table.length > 0) text += "import type { ViewModule } from 'abide/runtime'\n"

    // The files, embedded. `with { type: 'file' }` is what Bun reads as "put these bytes in the
    // executable"; what comes back is a path inside it, which `Bun.file` opens like any other.
    let embeds = ''
    const assetNames = embedded(manifest)
    for (let at = 0; at < assetNames.length; at++) {
        embeds += `import asset${at} from ${quoted(`${CLIENT_DIR}/${assetNames[at] as string}`, true)} with { type: 'file' }\n`
    }
    for (let at = 0; at < publics.length; at++) {
        embeds += `import public${at} from ${quoted(`${PUBLIC_DIR}/${publics[at] as string}`)} with { type: 'file' }\n`
    }
    text += `${embeds}\n${loaders}\n`

    text += `const pages = ${pagesOf(table, named, html)}\n\n`
    text += `const client = ${clientOf(manifest, assetNames)}\n\n`
    text += `const publics = ${publicsOf(publics)}\n\n`

    text += `process.exit(
    await binary(
        {
            name: ${JSON.stringify(name)},
            app: ${entry === null ? 'null' : 'app'},
            entry: ${JSON.stringify(entry)},
            endpoints: ${transports.length},
            pages,
            client,
            publics,
        },
        // What follows the executable. A standalone binary's \`argv\` is \`[bun, <the entry>, …]\`, the
        // same two the runtime puts in front of a script.
        Bun.argv.slice(2),
    ),
)
`
    return text
}

/** The pages as the image carries them: the walk, a thunk per file, and the document. */
function pagesOf(table: PageFiles[], named: Map<string, string>, html: string | null): string {
    if (table.length === 0) return 'null'
    let files = ''
    for (const row of table) {
        // `kind` travels with the row for the reason the client generator writes it: `pagesFrom`
        // reads it back off this, and an error page embedded as a plain row is a route shadowing the
        // real page at its directory — in a binary, where there is no scan to notice.
        files += `        { path: ${JSON.stringify(row.path)}, page: ${JSON.stringify(row.page)}, layouts: ${JSON.stringify(row.layouts)}, kind: ${JSON.stringify(row.kind)} },\n`
    }
    let loaders = ''
    for (const [file, local] of named) loaders += `        ${JSON.stringify(file)}: ${local},\n`
    return `{
    files: [
${files}    ],
    loaders: {
${loaders}    },
    html: ${JSON.stringify(html)},
}`
}

/** The manifest, and where each of the files it names was embedded. */
function clientOf(manifest: ClientManifest | null, assetNames: string[]): string {
    if (manifest === null) return 'null'
    let paths = ''
    for (let at = 0; at < assetNames.length; at++) {
        paths += `        ${JSON.stringify(assetNames[at])}: asset${at},\n`
    }
    // The manifest INLINE rather than embedded as a file: it is read once at boot and every reader of
    // it wants an object, so a file would be a parse of bytes that are in the binary either way.
    return `{
    manifest: ${JSON.stringify(manifest)},
    paths: {
${paths}    },
}`
}

function publicsOf(publics: string[]): string {
    if (publics.length === 0) return 'null'
    let paths = ''
    for (let at = 0; at < publics.length; at++)
        paths += `        ${JSON.stringify(`/${publics[at]}`)}: public${at},\n`
    return `{
${paths}}`
}

/**
 * Every file the build wrote, identity forms and sidecars alike.
 *
 * The sidecars are embedded because the manifest names them and `formsOf` opens every one: a binary
 * that carried only the identity bytes would answer a caller that accepts brotli with a path that is
 * not in the executable. They are also most of what makes the bundle small on the wire, which is the
 * whole reason the build wrote them.
 */
function embedded(manifest: ClientManifest | null): string[] {
    if (manifest === null) return []
    const names: string[] = []
    for (const name in manifest.assets) {
        names.push(name)
        for (const sidecar of (manifest.assets[name] as ClientAsset).encodings) names.push(sidecar.file)
    }
    return names
}

const HEADER = `// GENERATED by \`abide compile\`. Edits here are overwritten on the next compile — this file is the
// app's own tree read once, so that a binary with no tree under it serves exactly what \`abide start\`
// serves out of one.
`

/**
 * A path under the app root, as a specifier from wherever the generated lane lives.
 *
 * DERIVED from `BINARY_ENTRY` rather than counting `../` by hand, because the two are one fact and
 * the failure of their disagreeing is a build error about a path nobody typed. `inside` is for the
 * one directory that is under the lane rather than beside it — `.abide/client` — where the relative
 * path has no `../` to make it a relative specifier, and a bare `client/x.js` would resolve as a
 * package name.
 */
function quoted(path: string, inside = false): string {
    const from = relative(dirname(BINARY_ENTRY), path).replaceAll('\\', '/')
    return JSON.stringify(inside ? `./${from}` : from)
}
