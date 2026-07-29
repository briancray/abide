// preloadGraphOf(entry, chunkByPattern, files) — everything the SSR document `<link
// rel="modulepreload">`s in `<head>`, split into the part every page needs and the part that depends on
// which route matched.
//
// WHY IT IS COMPUTED AT ALL. The executing `<script type="module">` lives in `documentTail`, because it
// must not run before the hydration seed is parsed. That is correct, but it means the browser does not
// DISCOVER the client bundle until `responseEnd` — after every streamed read has drained. Measured on
// the docs app: boot download began at 128ms on a page whose `responseStart` was 7ms, and at 4494ms on
// one whose `responseStart` was 364ms. The head flushes with the shell and is seed-independent, so
// naming the graph there decouples "when the client starts downloading" from "how long this page's
// reads take" — the promise streaming SSR already kept for paint, but not for hydration.
//
// WHY EVERY CHUNK IS NAMED, not just the entry. Per the HTML spec a browser MAY follow a preloaded
// module's own static imports, but it is explicitly optional and Safari declines. Preloading only the
// entry therefore moves the waterfall down one level instead of removing it — measured: entry fetched
// at 140ms, its 47KB static dependency still at 4800ms. MDN is direct: "the only approach to ensure
// that all browsers will try to preload a module's dependencies is to individually specify them".
//
// WHAT IS DELIBERATELY ABSENT. Only STATIC edges are followed. The per-route chunks hang off
// `import(...)` in the entry, and are selected per request through `routeChunks` — walking the dynamic
// graph would fetch every route's code on every page, which is MDN's "you can't just preload
// everything" failure mode. `routeChunks` excludes anything already in `bootChunks` so a shared
// dependency is never preloaded twice in one document.

import { CHUNK_PREFIX } from './CHUNK_PREFIX.ts'
import type { ChunkAsset } from './clientBundle.ts'

export interface PreloadGraph {
    // The entry plus its transitive static imports, breadth-first — needed by every page.
    bootChunks: string[]
    // Route pattern → that route's chunk plus its transitive static imports, minus anything already in
    // `bootChunks`. Only the matched pattern's list is emitted into a given document.
    routeChunks: Map<string, string[]>
}

// Requiring a quote immediately after `import`/`from` is what excludes `import("…")`, which has a `(`
// there — that exclusion is the point, not an accident of the pattern.
//
// The specifiers are read out of the emitted BYTES rather than from build metadata because
// `publicPath` has already rewritten them to their final absolute URLs
// (`from"/__abide/chunk/loader-<hash>.js"`) — the exact strings the document needs — so this cannot
// drift from what the browser will actually request. Bun's output is minified, so the forms to match
// are `import"…"`, `import{…}from"…"` and `export{…}from"…"`.
// Built from `CHUNK_PREFIX` rather than restating it. `publicPath` rewrote these specifiers to that
// prefix at build time, so a rename that moved the route and the compression opt-out — which is what
// the constant already owns — would have left this pattern matching nothing: an EMPTY preload graph,
// no `modulepreload` links, and the boot waterfall back (392ms on the docs app), with no test to
// notice, since `preloadGraphOf` has none. The prefix carries no regex metacharacter, and `new RegExp`
// needs no escaping of `/`.
const STATIC_IMPORT = new RegExp(`(?:\\bfrom|\\bimport)\\s*["']${CHUNK_PREFIX}([^"']+)["']`, 'g')

function staticGraphOf(root: string, files: Map<string, ChunkAsset>, skip: Set<string>): string[] {
    const decoder = new TextDecoder()
    const ordered: string[] = []
    const seen = new Set<string>(skip)
    if (!seen.has(root)) {
        ordered.push(root)
        seen.add(root)
    }
    // Grows as it iterates — appending inside the loop IS the breadth-first queue.
    for (let index = 0; index < ordered.length; index++) {
        const chunk = ordered[index]
        if (chunk === undefined) continue
        const asset = files.get(chunk)
        if (asset === undefined) continue
        const source = decoder.decode(asset.identity)
        STATIC_IMPORT.lastIndex = 0
        for (;;) {
            const match = STATIC_IMPORT.exec(source)
            if (match === null) break
            const name = match[1]
            if (name === undefined || seen.has(name) || !files.has(name)) continue
            seen.add(name)
            ordered.push(name)
        }
    }
    return ordered
}

export function preloadGraphOf(
    entry: string,
    chunkByPattern: Map<string, string>,
    files: Map<string, ChunkAsset>,
): PreloadGraph {
    const bootChunks = staticGraphOf(entry, files, new Set())
    const boot = new Set(bootChunks)
    const routeChunks = new Map<string, string[]>()
    for (const [pattern, chunk] of chunkByPattern)
        routeChunks.set(pattern, staticGraphOf(chunk, files, boot))
    return { bootChunks, routeChunks }
}
