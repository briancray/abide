// The artifact's assembly and its manifest compatibility rule.
//
// Both were previously reachable only end-to-end: the only coverage of the manifest FORMAT was
// `cli/cli.test.ts` booting a live server against a fixture directory, which is an integration test
// standing in for a format contract. The third producer (`embeddedClientBuild`, inside a compiled binary)
// had no coverage of the shared tail at all.

import { describe, expect, test } from 'bun:test'
import { CHUNK_PREFIX } from './CHUNK_PREFIX.ts'
import {
    type ChunkAsset,
    type ClientManifest,
    clientBuildFrom,
    normalizeManifest,
    type StoredClientManifest,
} from './clientArtifact.ts'

function asset(source: string): ChunkAsset {
    return { identity: new TextEncoder().encode(source), gzip: null, brotli: null }
}

const FILES = new Map<string, ChunkAsset>([
    // The loader statically imports one chunk, so the preload graph has something to derive.
    // The specifier form matters: `publicPath` has already rewritten it to the served URL by the time
    // the graph is derived, which is what keeps the derivation from drifting off what the browser asks
    // for — so a fixture using a relative specifier would find nothing and pass a weaker test.
    ['loader-aaa.js', asset(`import"${CHUNK_PREFIX}shared-ccc.js";`)],
    ['shared-ccc.js', asset('export const x = 1')],
    [
        'route-bbb.js',
        asset(`import{x}from"${CHUNK_PREFIX}shared-ccc.js";export function mount(){}`),
    ],
])

describe('clientBuildFrom', () => {
    // The `null` → `undefined` conversion. Each of the three producers used to spell it, and the manifest
    // and the in-memory shape disagree on purpose: JSON has no `undefined`.
    test('a manifest css of null becomes an in-memory cssFile of undefined', () => {
        expect(
            clientBuildFrom({ entry: 'loader-aaa.js', css: null, chunkByPattern: {}, files: FILES })
                .cssFile,
        ).toBeUndefined()
        expect(
            clientBuildFrom({
                entry: 'loader-aaa.js',
                css: 'app-ddd.css',
                chunkByPattern: {},
                files: FILES,
            }).cssFile,
        ).toBe('app-ddd.css')
    })

    test('a record and a Map of chunkByPattern produce the same build', () => {
        const fromRecord = clientBuildFrom({
            entry: 'loader-aaa.js',
            css: null,
            chunkByPattern: { '/': 'route-bbb.js' },
            files: FILES,
        })
        const fromMap = clientBuildFrom({
            entry: 'loader-aaa.js',
            css: null,
            chunkByPattern: new Map([['/', 'route-bbb.js']]),
            files: FILES,
        })
        expect([...fromRecord.chunkByPattern]).toEqual([...fromMap.chunkByPattern])
        expect(fromRecord.bootChunks).toEqual(fromMap.bootChunks)
        expect([...fromRecord.routeChunks]).toEqual([...fromMap.routeChunks])
    })

    // DERIVED, not recorded — the property that lets a binary and a `dist/` serve identical head preloads
    // with nothing extra written at compile time.
    test('the preload graph is derived from the bytes, not carried in', () => {
        const built = clientBuildFrom({
            entry: 'loader-aaa.js',
            css: null,
            chunkByPattern: { '/': 'route-bbb.js' },
            files: FILES,
        })
        // The loader's own static import is part of the boot graph; the route chunk is not.
        expect(built.bootChunks).toContain('loader-aaa.js')
        expect(built.bootChunks).toContain('shared-ccc.js')
        expect(built.bootChunks).not.toContain('route-bbb.js')
        expect(built.routeChunks.get('/')).toContain('route-bbb.js')
        // And the exclusion that keeps a shared dependency from being preloaded twice in one document:
        // `route-bbb.js` imports `shared-ccc.js`, which is already in the boot graph.
        expect(built.routeChunks.get('/')).not.toContain('shared-ccc.js')
    })
})

describe('normalizeManifest', () => {
    const CURRENT: ClientManifest = {
        entry: 'loader-aaa.js',
        css: null,
        files: ['loader-aaa.js'],
        encodings: { 'loader-aaa.js': ['brotli', 'gzip'] },
        chunkByPattern: { '/': 'route-bbb.js' },
    }

    test('a current manifest passes through unchanged', () => {
        expect(normalizeManifest(CURRENT)).toEqual(CURRENT)
    })

    // THE DRIFT THIS CLOSED. `encodings` was required where the manifest was declared, optional where it
    // was read, and optional-chained where it was consumed — three answers to "may this be absent?" about
    // the field that decides whether a precompressed sidecar is served, embedded, or skipped. It is
    // required now, and the ONE place a manifest is decoded from JSON weakens it here.
    test('a manifest from a build older than `encodings` normalises to none, not undefined', () => {
        const old = {
            entry: 'loader-aaa.js',
            css: null,
            files: ['loader-aaa.js'],
            chunkByPattern: {},
        } satisfies StoredClientManifest
        const manifest = normalizeManifest(old)
        expect(manifest.encodings).toEqual({})
        // The consumers index it directly (`encodings[name]`), so it must never be undefined.
        expect(manifest.encodings['loader-aaa.js']).toBeUndefined()
    })
})
