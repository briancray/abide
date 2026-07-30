// THE CLIENT BUILD ARTIFACT — its in-memory shape, its on-disk shape, and the one mapping between them.
//
// Three places construct a `ClientBuild` from bytes: `buildClient` (fresh, in memory), `loadClientBuild`
// (from `dist/_app/<hash>/`), and `embeddedClientBuild` (from a compiled binary's embedded files). Each
// restated the same tail — `cssFile: css ?? undefined`, `chunkByPattern` as a `Map`, and the preload graph
// spread in — and two of them built that Map TWICE to do it. The rules being restated are not incidental:
// that `css: null` on the wire means `undefined` in memory, and that the preload graph is DERIVED from the
// bytes rather than recorded (so it cannot go stale against a manifest an older `abide build` wrote).
// `embeddedClientBuild`'s own comment pointed at the duplicate — "for the same reason the `dist/` loader
// derives it".
//
// `ClientManifest` was the sharper problem. `cli/build.ts` declared it "HERE, where it is produced, so the
// readers can import it instead of restating it" — and `loadClientBuild` never imported it, restating the
// shape inline. The two had ALREADY drifted on `encodings`: required in the declaration, optional in the
// reader (with a `?? {}`), and optional-chained in `stageCompileEntry` against the required form. Three
// parties, three answers, no compile error — and the field decides whether a precompressed sidecar is
// served, embedded, or silently skipped.
//
// It lives in `server/internal/` rather than beside `build()` in `cli/`, and that is load-bearing rather
// than tidy: the router reaches this module, and importing `cli/build.ts` would drag `loadApp`,
// `writeBakedSchemas` and `writeHealthCompanion` onto the request path — exactly the dependency floor
// `compiledAppFloor.test.ts` exists to hold.

import { preloadGraphOf } from './preloadGraphOf.ts'

// One served asset, in every encoding the build produced for it. The identity bytes are `Uint8Array`
// rather than `string` because this map is the SERVING representation, read once per request and never
// mutated — handing the router a string made it re-encode the same UTF-8 on every chunk fetch forever.
//
// Monomorphic on purpose: all three fields are always present, `null` standing for "this encoding was
// not worth keeping", so the negotiation reads the same hidden class for a compressed and an
// incompressible asset alike.
// The `<ArrayBuffer>` argument is not decoration: `BodyInit` (and `Bun.gzipSync`) reject the default
// `ArrayBufferLike` form, since a SharedArrayBuffer-backed view cannot be handed to a response body.
export interface ChunkAsset {
    identity: Uint8Array<ArrayBuffer>
    gzip: Uint8Array<ArrayBuffer> | null
    brotli: Uint8Array<ArrayBuffer> | null
}

// The built client: a content-addressed set of ES module files (the loader entry + code-split
// per-route chunks + Bun's shared chunks) plus the concatenated CSS, all served under `/__abide/chunk/`
// with immutable caching (each filename embeds a content hash). `entry` is the loader's hashed filename
// the SSR document boots from; `cssFile` is the stylesheet's hashed filename (undefined when the app
// bundles no CSS). Cached per config — an app's pages/routes are fixed for its lifetime.
export interface ClientBuild {
    entry: string
    cssFile: string | undefined
    files: Map<string, ChunkAsset>
    // Route pattern → its code-split chunk filename, for `<link rel="modulepreload">` of the matched
    // route's chunk (eliminates the first-load loader→dynamic-import waterfall).
    chunkByPattern: Map<string, string>
    // What the document head preloads, split into the always-needed boot graph and the per-route one.
    // Derived from the emitted bytes — see `preloadGraphOf.ts` for why it exists and what it omits.
    bootChunks: string[]
    routeChunks: Map<string, string[]>
}

// The manifest as it is written to `index.json` / `manifest.json`, and therefore as every reader must
// accept it. `encodings` is REQUIRED — `abide build` always writes it (empty object when nothing
// compressed), so a manifest without one was written by a build older than the field, which
// `clientBuildFrom`'s caller normalises at the single point it decodes JSON.
export interface ClientManifest {
    entry: string
    css: string | null
    files: string[]
    // name → the encodings written as sidecars beside it. RECORDED rather than probed so boot costs no
    // speculative `exists()` per file per encoding, and so a half-written build is a loud missing file
    // instead of a silently identity-only one.
    encodings: Record<string, string[]>
    chunkByPattern: Record<string, string>
}

// A manifest as it may arrive from disk: the same shape, with the fields a build older than them absent.
// Named rather than spelled inline at the read site, because "what an OLD manifest may omit" is a
// compatibility claim and belongs next to the current shape it is a weakening of.
export type StoredClientManifest = Omit<ClientManifest, 'encodings'> & {
    encodings?: Record<string, string[]>
}

export function normalizeManifest(stored: StoredClientManifest): ClientManifest {
    return { ...stored, encodings: stored.encodings ?? {} }
}

// The one assembly. Takes what a producer actually has — the entry, the CSS name in its ON-WIRE form
// (`null` for absent), the pattern map as a plain record or a Map, and the bytes — and applies the three
// rules every producer was restating.
export function clientBuildFrom(input: {
    entry: string
    css: string | null | undefined
    chunkByPattern: Record<string, string> | Map<string, string>
    files: Map<string, ChunkAsset>
}): ClientBuild {
    const chunkByPattern =
        input.chunkByPattern instanceof Map
            ? input.chunkByPattern
            : new Map(Object.entries(input.chunkByPattern))
    return {
        entry: input.entry,
        // `null` is the manifest's absent; `undefined` is the in-memory absent. One conversion.
        cssFile: input.css ?? undefined,
        files: input.files,
        chunkByPattern,
        // DERIVED, never recorded: the answer is a pure function of the bytes the caller just read, so
        // recomputing it costs one decode per preloaded chunk at startup and cannot go stale against a
        // manifest written by an older `abide build`.
        ...preloadGraphOf(input.entry, chunkByPattern, input.files),
    }
}
