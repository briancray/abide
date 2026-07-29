// The `<link rel="modulepreload">` graph — which had no test at all, and whose failure mode is
// SILENT and PERFORMANCE-ONLY: an empty graph emits no links, the document still renders, every
// assertion elsewhere still passes, and the boot waterfall the links exist to remove comes back
// (measured at 392ms on the docs app).
//
// That is what made restating the chunk prefix here dangerous. The scan reads specifiers out of the
// emitted BYTES, where `publicPath` has already rewritten them to their final absolute URLs — so a
// rename of `CHUNK_PREFIX`, which moves the serving route and the compression opt-out with it, used to
// leave this pattern matching nothing.

import { expect, test } from 'bun:test'
import { CHUNK_PREFIX } from './CHUNK_PREFIX.ts'
import type { ChunkAsset } from './clientBundle.ts'
import { preloadGraphOf } from './preloadGraphOf.ts'

const encoder = new TextEncoder()

function asset(source: string): ChunkAsset {
    return { identity: encoder.encode(source) as Uint8Array<ArrayBuffer>, gzip: null, brotli: null }
}

// Minified output, in the three forms Bun actually emits.
function files(graph: Record<string, string[]>): Map<string, ChunkAsset> {
    const map = new Map<string, ChunkAsset>()
    for (const [name, imports] of Object.entries(graph)) {
        const source = imports
            .map((target, index) =>
                index % 2 === 0
                    ? `import"${CHUNK_PREFIX}${target}";`
                    : `import{x}from"${CHUNK_PREFIX}${target}";`,
            )
            .join('')
        map.set(name, asset(`${source}export{};`))
    }
    return map
}

test('the boot graph is the entry plus its transitive static imports, breadth-first', () => {
    const graph = preloadGraphOf(
        'loader.js',
        new Map(),
        files({
            'loader.js': ['a.js', 'b.js'],
            'a.js': ['c.js'],
            'b.js': ['c.js'], // already queued — each chunk appears exactly once
            'c.js': [],
        }),
    )
    expect(graph.bootChunks).toEqual(['loader.js', 'a.js', 'b.js', 'c.js'])
})

test("a route's chunks exclude everything the boot graph already names", () => {
    const graph = preloadGraphOf(
        'loader.js',
        new Map([
            ['/', 'page-home.js'],
            ['/about', 'page-about.js'],
        ]),
        files({
            'loader.js': ['shared.js'],
            'shared.js': [],
            'page-home.js': ['shared.js', 'home-only.js'],
            'home-only.js': [],
            'page-about.js': ['shared.js'],
        }),
    )
    expect(graph.bootChunks).toEqual(['loader.js', 'shared.js'])
    // `shared.js` is already in the boot graph, so neither route repeats it.
    expect(graph.routeChunks.get('/')).toEqual(['page-home.js', 'home-only.js'])
    expect(graph.routeChunks.get('/about')).toEqual(['page-about.js'])
})

// The whole reason the pattern is built from `CHUNK_PREFIX`: it must match the specifiers
// `publicPath` writes, and nothing else. A bare relative specifier is not one of them.
test('only specifiers under the chunk prefix are followed', () => {
    const map = new Map<string, ChunkAsset>()
    map.set('loader.js', asset(`import"./relative.js";import"${CHUNK_PREFIX}real.js";export{};`))
    map.set('relative.js', asset('export{};'))
    map.set('real.js', asset('export{};'))
    expect(preloadGraphOf('loader.js', new Map(), map).bootChunks).toEqual(['loader.js', 'real.js'])
})

// A DYNAMIC import is another route's code; following it would preload the whole app on every page.
test('a dynamic import is not a static edge', () => {
    const map = new Map<string, ChunkAsset>()
    map.set('loader.js', asset(`var L={"/":()=>import("${CHUNK_PREFIX}page.js")};export{};`))
    map.set('page.js', asset('export{};'))
    expect(preloadGraphOf('loader.js', new Map(), map).bootChunks).toEqual(['loader.js'])
})
