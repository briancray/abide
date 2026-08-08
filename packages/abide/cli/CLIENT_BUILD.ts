// What `abide build` writes, as a shape rather than as a convention.
//
// Its own file, with NO imports, for the same reason `CLI_EXIT_CODES` is its own file: `abide --help`
// is the most common thing this binary is asked for, and `cli/index.ts` re-exports these so an app
// can read a manifest without the command that wrote one dragging the compiler in behind it. The
// paths are here rather than in `internal/build.ts` for the same reason — a server that serves the
// build needs to know where it is, and must not load a bundler to find out.
//
// `.abide/` is already this project's build directory: `abide/compiler/shapes` writes `shapes.json`
// beside this, and the whole of it is gitignored. One directory rather than two means one line in a
// `.dockerignore` and one thing to delete.

/** Where the client bundle is written, relative to the project root. */
export const CLIENT_DIR = '.abide/client'

/** The manifest, relative to the project root. Every path INSIDE it is relative to `CLIENT_DIR`. */
export const MANIFEST_FILE = `${CLIENT_DIR}/manifest.json`

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
