// `abide build` — the client, code-split, hashed, minified and precompressed.
//
// The one command with no runtime half: everything else this binary does is a process you can watch,
// and this writes files and stops. What it produces is `.abide/client/` — content-hashed chunks, a
// `manifest.json` naming them, and a `.br`/`.gz` beside anything that compressed smaller.
//
// The whole of the transformation is Bun's, and deliberately: `Bun.build` splits, hashes, minifies
// and tree-shakes, and a second bundler wired in here would be a second answer to what a module
// means. What this file adds is the four decisions Bun does not make — which lane, where the output
// goes, what gets compressed, and what the manifest says.
//
// The lane itself is `lane.ts`, shared with `abide dev`: what the bundle CONTAINS is the same
// question for both commands, and this one answers only the three below.

// `Bun.write` builds a tree but never removes one, and `node:path` stands in for nothing — Bun
// ships no path api. `node:util`/`node:zlib` are the brotli lane; see `brotliOf` below for why.
import { rm } from 'node:fs/promises'
import { basename } from 'node:path'
import { promisify } from 'node:util'
import { brotliCompress, constants as ZLIB } from 'node:zlib'
import { messageOf } from '$shared/internal/probes.ts'
import { CLI_EXIT_CODES } from '../CLI_EXIT_CODES.ts'
import {
    assetOf,
    CLIENT_DIR,
    CLIENT_ENTRIES,
    CLIENT_KEY,
    type ClientAsset,
    type ClientManifest,
    clientGraph,
    entryNames,
    MANIFEST_FILE,
    type Sidecar,
} from '../CLIENT_BUILD.ts'
import { clientLane, GENERATED_ENTRY } from './entry.ts'
import { clientBuild, type Lane } from './lane.ts'
import { BOLD, colored, DIM, paint, plural } from './paint.ts'

/**
 * What a build that is going to be DEPLOYED asks for, where `abide dev` reverses all three.
 *
 * The hash is in the NAME rather than in a query, so a chunk is immutable at its address and an
 * operator caches the directory forever. `[name]` stays in front of it because an address legible in
 * a network panel is worth the eight bytes — the same trade the transport lane makes by keeping the
 * module path in an endpoint's URL instead of hashing it.
 */
const SHIPPED: Lane = {
    minify: true,
    naming: { entry: '[name]-[hash].[ext]', chunk: '[name]-[hash].[ext]', asset: '[name]-[hash].[ext]' },
    sourcemap: 'none',
}

export async function build(argv: string[]): Promise<number> {
    // Entries, not flags — the command IS the build, and a knob here would be a second place the
    // output shape is decided from. Anything starting with `-` is refused rather than ignored,
    // because a `--minify` somebody typed and this quietly dropped is a build that did not do what
    // they asked and said nothing.
    for (const argument of argv) {
        if (argument.startsWith('-')) {
            console.error(`abide build: unknown option \`${argument}\``)
            console.error('       usage: abide build [entry…]')
            return CLI_EXIT_CODES.usage
        }
    }

    const root = process.cwd()
    let entries = argv
    // Reported rather than silent: a lane nobody wrote is a file the next reader will not find in
    // their own source tree, and the one line that says where it came from is the whole of the fix.
    let generated = false
    // The manifest keys, when they are not the entry paths. Only the conventional lane sets them —
    // an entry somebody NAMED is keyed by what they named, because that is what their document says.
    let keys: string[] | undefined
    if (entries.length === 0) {
        // The conventional lane when nothing was named: the app's own `client.ts` if it wrote one,
        // and otherwise one generated from `pages/`, because a route table is already on disk and
        // retyping it for the browser is the one piece of an app nobody should be writing by hand.
        const lane = await clientLane(root)
        if (lane !== null) {
            entries = [lane.path]
            keys = [CLIENT_KEY]
            generated = lane.generated
        }
    }
    if (entries.length === 0) {
        console.error(`abide build: nothing to build — no ${CLIENT_ENTRIES.join(', ')} and no pages/ here`)
        console.error('       name one: abide build <entry…>')
        return CLI_EXIT_CODES.usage
    }

    let built: Bun.BuildOutput
    try {
        built = await clientBuild(entries, SHIPPED, root)
    } catch (failure) {
        // A plugin the app declared and this could not load. Loud, because the build that would have
        // followed it is one that succeeds and ships a page missing whatever the plugin makes.
        console.error(`abide build: ${messageOf(failure)}`)
        return CLI_EXIT_CODES.failed
    }

    if (!built.success) {
        for (const message of built.logs) console.error(String(message))
        return CLI_EXIT_CODES.failed
    }

    // Cleaned rather than merged. A hash makes a chunk immutable at its address, which also means a
    // build never overwrites the last one's output — so merging would leave every chunk every
    // previous build produced sitting there, served by nothing and shipped in the image.
    const out = `${root}/${CLIENT_DIR}`
    await rm(out, { recursive: true, force: true })

    // Every artifact at once. Compression is the whole cost of this command past the bundle, and the
    // artifacts are independent — one waiting on another's brotli is wall time spent on nothing. The
    // names are collected FIRST so the manifest's key order is the bundler's rather than whichever
    // chunk finished compressing first, which is what makes a rebuild produce the same document.
    const names: string[] = []
    const pending: Promise<ClientAsset>[] = []
    for (const artifact of built.outputs) {
        const name = basename(artifact.path)
        names.push(name)
        pending.push(written(out, name, artifact))
    }
    const settled = await Promise.all(pending)

    const assets: Record<string, ClientAsset> = {}
    for (let at = 0; at < names.length; at++) assets[names[at] as string] = settled[at] as ClientAsset

    const manifest: ClientManifest = {
        entries: entryNames(root, entries, built.outputs, keys),
        assets,
        graph: clientGraph(built.metafile, root),
    }
    await Bun.write(`${root}/${MANIFEST_FILE}`, `${JSON.stringify(manifest, null, 4)}\n`)

    report(manifest, generated)
    return CLI_EXIT_CODES.ok
}

/** One artifact on disk, with its sidecars, as the manifest records it. */
async function written(out: string, name: string, artifact: Bun.BuildArtifact): Promise<ClientAsset> {
    const bytes = new Uint8Array(await artifact.arrayBuffer())
    await Bun.write(`${out}/${name}`, bytes)
    return assetOf(artifact, bytes.byteLength, await compress(out, name, bytes))
}

// Brotli through `node:zlib` because `Bun.*` has no brotli — it has gzip, deflate and zstd. The one
// place in this file a Node API is reached for, and it is reached for because the alternative is not
// writing the encoding every browser has sent for a decade. The ASYNC form: the sync one is a
// max-quality compress that holds the thread, which is what stopped the artifacts overlapping.
const brotliOf = promisify(brotliCompress)

/**
 * The `.br` and `.gz` beside one asset, smallest first.
 *
 * Written only when the sidecar is SMALLER than the bytes it stands in for. That is not a rounding
 * error on a bundle of chunks — a 90-byte chunk gzips to about 110 — and a server that served the
 * larger form would be spending a decompress on the client to send more bytes. The manifest lists
 * what exists rather than what was attempted, which is why `encodings` is a list and not two flags.
 *
 * Both are asked at their MAXIMUM setting rather than their default: a build trades wall time for
 * bytes on every request afterwards, and the wall time is bought back by compressing the artifacts
 * concurrently rather than by asking either of them for less.
 */
async function compress(
    out: string,
    name: string,
    // `<ArrayBuffer>` rather than the default `<ArrayBufferLike>`: `Bun.gzipSync` will not take a view
    // that might be over a `SharedArrayBuffer`, and an artifact's bytes never are.
    bytes: Uint8Array<ArrayBuffer>,
): Promise<Sidecar[]> {
    const sidecars: Sidecar[] = []

    const brotli = await brotliOf(bytes, {
        params: {
            [ZLIB.BROTLI_PARAM_QUALITY]: ZLIB.BROTLI_MAX_QUALITY,
            // The window and the size hint together are what let it beat gzip on a bundle rather than
            // tie with it; both are free to declare and neither is guessed — the size is known here.
            [ZLIB.BROTLI_PARAM_LGWIN]: ZLIB.BROTLI_MAX_WINDOW_BITS,
            [ZLIB.BROTLI_PARAM_SIZE_HINT]: bytes.byteLength,
        },
    })
    if (brotli.byteLength < bytes.byteLength) {
        await Bun.write(`${out}/${name}.br`, brotli)
        sidecars.push({ encoding: 'br', file: `${name}.br`, size: brotli.byteLength })
    }

    const gzip = Bun.gzipSync(bytes, { level: 9 })
    if (gzip.byteLength < bytes.byteLength) {
        await Bun.write(`${out}/${name}.gz`, gzip)
        sidecars.push({ encoding: 'gzip', file: `${name}.gz`, size: gzip.byteLength })
    }

    // Smallest first, so a server negotiating `Accept-Encoding` takes the first match rather than
    // comparing sizes per request. Brotli beats gzip on essentially every bundle, but the order is
    // MEASURED here rather than assumed, because the one asset where it does not is exactly the one
    // a hardcoded preference would get wrong.
    sidecars.sort((a, b) => a.size - b.size)
    return sidecars
}

/**
 * What the build was, on stdout.
 *
 * Sorted by name and not by size: two builds of one tree should produce the same report, and a size
 * ordering shuffles the whole list when one chunk grows by a byte.
 */
function report(manifest: ClientManifest, generated: boolean): void {
    const on = colored()
    const names = Object.keys(manifest.assets).sort()

    if (generated) {
        console.log(paint(`${GENERATED_ENTRY}  the lane, written from pages/ — copy it to`, DIM, on))
        console.log(paint('                       client.ts to take it over', DIM, on))
    }

    let width = 0
    for (const name of names) if (name.length > width) width = name.length

    console.log(paint(CLIENT_DIR, BOLD, on))
    let identity = 0
    let best = 0
    for (const name of names) {
        const asset = manifest.assets[name] as ClientAsset
        identity += asset.size
        const smallest = asset.encodings[0]
        best += smallest === undefined ? asset.size : smallest.size
        const shrunk =
            smallest === undefined ? 'no smaller compressed' : `${smallest.encoding} ${bytes(smallest.size)}`
        console.log(`  ${name.padEnd(width)}  ${bytes(asset.size).padStart(9)}  ${paint(shrunk, DIM, on)}`)
    }
    console.log(
        paint(
            `  ${plural(names.length, 'file')} · ${bytes(identity)} · ${bytes(best)} over the wire`,
            DIM,
            on,
        ),
    )
}

function bytes(count: number): string {
    return count < 1024 ? `${count} B` : `${(count / 1024).toFixed(1)} kB`
}
