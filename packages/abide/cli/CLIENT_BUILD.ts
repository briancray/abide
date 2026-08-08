// What `abide build` writes, as a shape rather than as a convention.
//
// Its own file, with one import, for the same reason `CLI_EXIT_CODES` is its own file: `abide --help`
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
 * What the build is pointed at when nothing is named, in the order it is looked for.
 *
 * `client` beside `app`, which is what an app already calls the other half — the two entry points of
 * an isomorphic app are the two lanes it has, and naming them after the lanes is why neither needs a
 * config file to be found. The first one that EXISTS wins rather than every one that does: two
 * client entries in a root is a mistake, and building both would hide it.
 *
 * Here rather than in the builder because `abide start` reads it too: a lane that is written with no
 * bundle beside it is the one shape that is unambiguously a mistake, and a second copy of this list
 * is how that refusal silently stops firing for an extension somebody added to only one of them.
 */
export const CLIENT_ENTRIES = ['client.ts', 'client.tsx', 'client.abide', 'client.js']

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
 */
export function entryNames(
    root: string,
    entries: string[],
    outputs: readonly { kind: string; path: string }[],
): Record<string, string> {
    const produced: Record<string, string> = {}
    let at = 0
    for (const artifact of outputs) {
        if (artifact.kind !== 'entry-point') continue
        const entry = entries[at++]
        if (entry !== undefined) produced[relative(root, resolve(root, entry))] = basename(artifact.path)
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
}
