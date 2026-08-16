// What `abide build` writes, as a shape rather than as a convention.
//
// Its own file, for the same reason `CLI_EXIT_CODES` is its own file: `abide --help`
// is the most common thing this binary is asked for, and `cli/index.ts` re-exports these so an app
// can read a manifest without the command that wrote one dragging the compiler in behind it. The
// paths are here rather than in `internal/build.ts` for the same reason — a server that serves the
// build needs to know where it is, and must not load a bundler to find out.
//
// `.abide/` is already this project's build directory: `abide/compiler/shapes` writes `shapes.json`
// beside this, and the whole of it is gitignored. One directory rather than two means one line in a
// `.dockerignore` and one thing to delete.
//
// `node:path` is the only weight here, and it is a builtin: the rule is that reading a manifest must
// not load a BUNDLER, not that this file may not resolve a path.

// `node:path` stands in for nothing: Bun ships no path api, and the builtin IS the supported one.
import { basename, relative, resolve } from 'node:path'

/**
 * Where `abide start` serves the bundle FROM — the address side of the same fact.
 *
 * Re-exported rather than declared, because it belongs in the table of everything abide has claimed
 * under the reserved prefix: an operator proxies, caches or excludes `/__abide/**` with one pattern,
 * and a segment claimed away from that table is one nothing else can know is taken.
 */
export { CLIENT_ROUTE } from '$shared/internal/PATHS.ts'

/** Where the client bundle is written, relative to the project root. */
export const CLIENT_DIR = '.abide/client'

/** The manifest, relative to the project root. Every path INSIDE it is relative to `CLIENT_DIR`. */
export const MANIFEST_FILE = `${CLIENT_DIR}/manifest.json`

/**
 * What an app's client lane USED to be called, kept only to say that it is not one any more.
 *
 * The lane is now always generated from `pages/` — see `internal/entry.ts` — so a file by any of
 * these names is built by nothing. That is the quietest breakage an upgrade could have: the app
 * still builds and still starts, and the only symptom is that whatever was in the file stopped
 * happening. So the names stay listed, and `clientLane` warns on any of them.
 *
 * All four rather than `client.ts` alone: an app that wrote `client.tsx` is owed the same sentence.
 */
export const CLIENT_ENTRIES = ['client.ts', 'client.tsx', 'client.abide', 'client.js']

/**
 * What the manifest keys the client lane by, whoever wrote it.
 *
 * The generated entry is at `.abide/client.entry.ts` and an app's own is at `client.ts`, and a
 * document must not have to know which: `app.html` names `src="./client.ts"` and `shell.ts` maps that
 * through `manifest.entries`, so the CONVENTIONAL name is the address in both cases. An app that
 * writes no client entry still writes the same head as one that does.
 *
 * Beside the list it is the first of, because the two facts are one: `CLIENT_ENTRIES` is what a lane
 * may be CALLED and this is what it is ADDRESSED by.
 */
export const CLIENT_KEY = 'client.ts'

/**
 * Where the pages are. A directory rather than a declaration — the tree IS the route table.
 *
 * Here rather than in either reader because both of them write the name into something the other
 * has to match: `entry.ts` emits `import('../pages/…')` specifiers and `layers.ts` builds
 * `pages/<file>` graph keys off it. Two copies is a rename that reaches one and produces a lane
 * importing nothing, with a build that still succeeds.
 */
export const PAGES = 'pages'

/**
 * The first of `names` that is actually under `root`, or `null` for none of them.
 *
 * Beside the list rather than beside either caller, for the reason the list itself is here: `abide
 * build` and `abide start` have to agree about where a lane IS, and a probe written once per command
 * is how one learns about an extension the other does not. `Bun.file` and nothing else, so this file
 * stays what its header says it is.
 */
export async function firstPresent(root: string, names: string[]): Promise<string | null> {
    for (const name of names) {
        const path = `${root}/${name}`
        if (await Bun.file(path).exists()) return path
    }
    return null
}

/**
 * Which file each entry produced, keyed as the manifest keys it.
 *
 * Here rather than in either builder because BOTH lanes produce a manifest — `abide build` writes one
 * to disk and `abide dev` holds one in memory — and the entry keys are what an `app.html`'s
 * `src="./client.ts"` is looked up by. Two copies of this is one lane rewriting a document and the
 * other quietly not.
 *
 * Bun hands entry points back in the order they were given, so the two lists zip. Matching on the
 * filename instead would need this to reproduce `[name]-[hash]`, which is the bundler's rule and not
 * ours to restate.
 *
 * The key is what the file IS rather than how somebody typed it: `abide build ./client.ts` and
 * `abide build client.ts` name one entry, and a manifest recording them as two would hand a server a
 * name it cannot look up.
 *
 * `keys` overrides that, positionally, for the one case where where a module IS and what a document
 * NAMES it by are different files: a generated lane sits in `.abide/` and an `app.html` still writes
 * `src="./client.ts"`. See `internal/entry.ts` — the conventional name is the address whether or not
 * the app wrote the file.
 */
export function entryNames(
    root: string,
    entries: string[],
    outputs: readonly { kind: string; path: string }[],
    keys?: string[],
): Record<string, string> {
    const produced: Record<string, string> = {}
    let at = 0
    for (const artifact of outputs) {
        if (artifact.kind !== 'entry-point') continue
        const entry = entries[at]
        const key = keys?.[at]
        at++
        if (entry === undefined) continue
        produced[key ?? relative(root, resolve(root, entry))] = basename(artifact.path)
    }
    return produced
}

/**
 * A `Content-Encoding` token, which is also what an `Accept-Encoding` is matched against.
 *
 * `br` and `gzip` and not the third thing Bun can do: `zstd` is compressed natively by `Bun.*` where
 * brotli costs a `node:zlib` import, and it is still the one no browser sends `Accept-Encoding: zstd`
 * for by default. A sidecar nothing asks for is disk and build time spent on nobody.
 */
export type Encoding = 'br' | 'gzip'

/** A precompressed form written BESIDE the identity bytes, never instead of them. */
export interface Sidecar {
    encoding: Encoding
    /** The file beside the identity form — the same name plus `.br` or `.gz`. */
    file: string
    /** Bytes, so a server can answer `Content-Length` without asking the filesystem. */
    size: number
}

export interface ClientAsset {
    /** `entry` is something the command was pointed at; a `chunk` is what splitting made of it. */
    kind: 'entry' | 'chunk' | 'asset'
    /** The identity form's size, in bytes. */
    size: number
    /** What this is served as. Bun decides it from the loader, so nothing here maps an extension. */
    type: string
    /**
     * The sidecars that exist, SMALLEST first.
     *
     * Empty when neither compressed smaller than the bytes themselves — which is the common answer
     * for a chunk of a few hundred bytes, and the reason this is a list rather than two booleans a
     * server would have to test the disk for. A server walks it and takes the first the caller
     * accepts, so "best available" costs no comparison at request time.
     */
    encodings: Sidecar[]
}

/**
 * One artifact as the manifest records it, without the bytes.
 *
 * Beside `entryNames` and for the reason that one is here: BOTH lanes produce a manifest, and the
 * `kind` vocabulary decided twice is a Bun artifact classified one way on a disk and another in
 * memory, with `test/build.test.ts` asserting only one of them. The size and the sidecars are the
 * caller's, because only it knows where the bytes went.
 */
export function assetOf(
    artifact: { kind: string; type: string },
    size: number,
    encodings: Sidecar[],
): ClientAsset {
    return {
        kind: artifact.kind === 'entry-point' ? 'entry' : artifact.kind === 'chunk' ? 'chunk' : 'asset',
        size,
        type: artifact.type,
        encodings,
    }
}

/**
 * Which file holds a source module, and what each file pulls in behind it.
 *
 * This is what makes a route's chunk NAMEABLE before anything has imported it, and that is the whole
 * reason it exists. Splitting is what keeps a page's code out of the first load; the cost is that the
 * browser cannot discover the chunk until the entry has downloaded, parsed and run far enough to
 * reach the `import()` — two serial round trips of JavaScript before the page is interactive. A
 * server that knows which route it is rendering can name the chunk in the head instead, and the two
 * fetches overlap.
 *
 * Neither half is derivable from the filenames. `[name]-[hash]` is the bundler's rule and reproducing
 * it here would be restating it; the import graph is not in the names at all.
 */
export interface ClientGraph {
    /** Source path, relative to the project root, to the file that holds it. */
    modules: Record<string, string>
    /** Output name to the names it imports, so a preload can reach a whole subtree rather than a face of it. */
    imports: Record<string, string[]>
}

/**
 * The build, as one document.
 *
 * Content hashes are in the FILENAMES, so this is the only thing that knows which name an entry ended
 * up with — that is what a manifest is for, and why it is the one file in here without a hash of its
 * own.
 */
export interface ClientManifest {
    /** Entry source path, relative to the project root, to the file it produced. */
    entries: Record<string, string>
    /** Every file written, keyed by its path relative to `CLIENT_DIR`. */
    assets: Record<string, ClientAsset>
    /**
     * Optional because this whole interface is a CLAIM rather than a guarantee: the manifest is read
     * off disk and `JSON.parse(text) as ClientManifest`, with nothing validating it. So the field can
     * be missing at runtime whatever the type says, and this is the one where absence has a sane
     * meaning — preload nothing — which is why the reader in `layers.ts` branches on it rather than
     * trusting it. Making it required would enforce on readers a promise the parse cannot keep, and
     * the guard would then read as dead code to whoever next tidies that file.
     *
     * `clientGraph` also answers `undefined` when the bundler recorded no metafile, which is the only
     * way a build abide itself wrote gets here without one.
     */
    graph?: ClientGraph | undefined
}

/**
 * The module graph, out of what the bundler recorded.
 *
 * `entryPoint` is the whole trick: Bun sets it on every output that is the target of an `import()`,
 * not just on the ones the command was pointed at — so a route's chunk names the `.abide` file it was
 * split out of, and the mapping is READ rather than reconstructed. Everything is reduced to basenames
 * because that is how `assets` is keyed and how `/__abide/client/` addresses them; the metafile's own
 * `./` prefixes are relative to a working directory no server shares.
 *
 * Here beside the manifest for the reason `entryNames` is: both lanes produce one, and a graph built
 * one way for `abide build` and another for `abide dev` is a preload that is right on a disk and
 * wrong in memory.
 */
export function clientGraph(metafile: Bun.BuildMetafile | undefined, root: string): ClientGraph | undefined {
    if (metafile === undefined) return undefined
    const modules: Record<string, string> = {}
    const imports: Record<string, string[]> = {}
    for (const path in metafile.outputs) {
        const output = metafile.outputs[path] as Bun.BuildMetafile['outputs'][string]
        const name = basename(path)
        // Keyed the way `entryNames` keys `entries`, and for the same reason: the bundler records
        // `entryPoint` against ITS working directory, and the server looks a module up by where it
        // sits under the app's root. The two agree today only because the commands are run from the
        // root — and a miss here is silent, producing no preloads rather than a wrong one.
        if (output.entryPoint !== undefined) modules[relative(root, resolve(output.entryPoint))] = name
        // Static imports only. A `dynamic-import` is a chunk the browser fetches WHEN it gets there,
        // and preloading those transitively would pull the whole route table into the first load —
        // which is the splitting this exists to preserve, undone by the thing meant to speed it up.
        const named: string[] = []
        for (const held of output.imports) {
            if (held.kind === 'import-statement') named.push(basename(held.path))
        }
        if (named.length > 0) imports[name] = named
    }
    return { modules, imports }
}
