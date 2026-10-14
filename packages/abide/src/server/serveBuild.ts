// 38.6 and 38.10 — `abide start` and a compiled app: the built app, over http. The request path is
// `answerRequest`'s, shared with `abide dev`; what this module is, is the SUPPLIER — where each part
// comes from when the parts are what `abide build` produced.
//
// THE ROUTE TABLE IS THE BUILD'S, not this module's. `abide build` walks the tree once and writes
// what it found, so the addresses the server answers and the addresses the client router knows
// are two readings of one walk rather than two walks that have to agree (30.8).

import {
    type Compilation,
    serveCompilation,
    servedTable,
} from './abideModules.ts'
import {
    type AppSources,
    appSources,
    type SourceParts,
} from './answerRequest.ts'
import {
    CLIENT_DIRECTORY,
    COMPILATION,
    ENCODING_SUFFIX,
    MANIFEST,
    PUBLIC_DIRECTORY,
} from './CLIENT_BUILD.ts'
import { bundleServer, type ServedFile } from './clientBundle.ts'
import type { Manifest } from './manifestOf.ts'
import { namesUnder } from './namesUnder.ts'
import { ENCODINGS } from './negotiateEncoding.ts'
import { runBuild } from './runBuild.ts'

/**
 * What `abide build` produced, as the parts an `App` is booted over.
 *
 * Read off disk by `abide start` (`loadBuild`), and out of the executable itself by a compiled app
 * (38.10). ONE SHAPE, so the two are answered by one path and differ only in where a byte is read
 * from — a file is a PATH in both, and `Bun.file` reads the executable's own the same way it reads
 * the disk's.
 */
export type BuildParts = Omit<SourceParts, 'client' | 'explained'> & {
    manifest: Manifest
    /** Every file under `client/`, the precompressed copies among them, by name to its path. */
    client: Map<string, string>
}

/**
 * Serves the compilation `abide build` kept in `out` to this process's imports; `false` where there
 * is none, because the app under `root` holds nothing to build.
 *
 * 38.6 — what `abide start` boots: no compiler is loaded, and every `.abide` the app imports is
 * answered out of what the build compiled. 38.100 — AN APP NOBODY BUILT IS BUILT, by `build`, rather
 * than refused, so every caller boots the same way whether or not a build came first. The CLI passes
 * its own build, in-process; anything else spawns it.
 */
export async function serveBuild(
    root: string,
    out: string,
    build: (root: string, out: string) => Promise<unknown> = runBuild,
): Promise<boolean> {
    const path = `${out}/${COMPILATION}`
    if (!(await Bun.file(path).exists())) {
        await build(root, out)
        // A FRESH HANDLE: one taken before the build wrote the file reads it as empty.
        if (!(await Bun.file(path).exists())) return false
    }
    serveCompilation(root, (await Bun.file(path).json()) as Compilation)
    return true
}

/**
 * What `abide build` left on disk, as the sources an `App` is booted over — its compilation served
 * already (`serveBuild`).
 */
export async function loadBuild(options: {
    /**
     * The app's source root — the directory its pages sit under.
     */
    root: string
    /** Where `abide build` put its output. */
    out: string
}): Promise<AppSources> {
    // THE BOOT READS OVERLAP: the tables and the manifest are independent of each other. The
    // manifest names the stylesheet only where the bundler collected one, so an app that imports
    // none links none.
    const [table, manifest] = await Promise.all([
        servedTable(options.root),
        Bun.file(`${options.out}/${MANIFEST}`).json() as Promise<Manifest>,
    ])
    return builtSources({
        table,
        handlers: table.handlers,
        manifest,
        client: pathsUnder(`${options.out}/${CLIENT_DIRECTORY}`),
        published: pathsUnder(`${options.out}/${PUBLIC_DIRECTORY}`),
    })
}

/** Every file under `directory`, by the name below it to its path. */
export function pathsUnder(directory: string): Map<string, string> {
    const paths = new Map<string, string>()
    for (const name of namesUnder(directory))
        paths.set(name, `${directory}/${name}`)
    return paths
}

/** The sources an `App` is booted over, out of the parts `abide build` produced. */
export function builtSources(parts: BuildParts): Promise<AppSources> {
    // THE PRECOMPRESSED COPIES ARE NOT ADDRESSES OF THEIR OWN. They are the same file in another
    // encoding (38.5), so they are found under the name they encode and served as that name.
    const suffixes = Object.values(ENCODING_SUFFIX) as string[]
    const files = new Map<string, ServedFile>()
    for (const [name, path] of parts.client) {
        if (suffixes.some((suffix) => name.endsWith(suffix))) continue
        const encoded: ServedFile['encoded'] = {}
        for (const encoding of ENCODINGS) {
            const copy = parts.client.get(name + ENCODING_SUFFIX[encoding])
            if (copy !== undefined) encoded[encoding] = () => Bun.file(copy)
        }
        files.set(name, {
            // THE TYPE IS THE NAME'S, not the path's: a compiled app's path carries a hash the
            // bundler put before the extension, and a `.br`'s extension names nothing.
            type: Bun.file(name).type,
            body: () => Bun.file(path),
            encoded,
        })
    }
    return appSources({
        ...parts,
        explained: undefined,
        client: {
            manifest: parts.manifest,
            head: '',
            // 21.5 — EVERY NAME IN THE BUNDLE CARRIES A HASH OF ITS BYTES, the entry's too (38.5), so
            // a name never answers two different files and a year is safe for all of them. A deploy
            // is new names in a new document, never new bytes at an old address.
            framework: bundleServer(
                files,
                'public, max-age=31536000, immutable',
            ),
        },
    })
}
