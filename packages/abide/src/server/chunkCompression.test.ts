// A production build PRECOMPRESSES the content-addressed client assets and the chunk route negotiates
// `Accept-Encoding` over them. The contract here is about WORK, not output: every assertion below would
// still pass on an uncompressed server if it only checked that the right JavaScript came back, so each
// one names the representation — the encoding header, the stored byte counts, the ratio — rather than
// the decoded text alone.
//
// Bun's `fetch` transparently decodes a compressed response but LEAVES `content-encoding` in place, so
// a test can assert the wire encoding and the decoded bytes at the same time: proof the server really
// sent brotli AND that it round-trips to the identity content.

import { expect, test } from 'bun:test'
import { buildClient } from '../server/internal/clientBundle.ts'
import type { AppConfig } from '../server/internal/router.ts'
import { createTestApp } from '../test/createTestApp.ts'
import { negotiateEncoding } from './internal/negotiateEncoding.ts'
import { staticAssetType } from './internal/staticAssetType.ts'

// A page with enough distinct content that its chunk clears the one-MTU compression floor.
const PAGE =
    "<script>import { state } from 'abide/shared/state'; let title = state('Compression')</script>" +
    `<h1>{title}</h1><p>${'the quick brown fox jumps over the lazy dog. '.repeat(30)}</p>`

function productionConfig(): AppConfig {
    return { dev: false, pages: { '/': PAGE } }
}

test('a production build stores brotli + gzip only where they beat the identity bytes', async () => {
    const build = await buildClient(productionConfig())

    let compressed = 0
    for (const [name, asset] of build.files) {
        // Whatever IS stored must be a real win — this is the guard that lets CONTENT_TYPE_BY_EXTENSION
        // mark a format compressible without having to be sure it compresses.
        if (asset.brotli !== null)
            expect(asset.brotli.byteLength).toBeLessThanOrEqual(asset.identity.byteLength * 0.9)
        if (asset.gzip !== null)
            expect(asset.gzip.byteLength).toBeLessThanOrEqual(asset.identity.byteLength * 0.9)
        // Nothing under the floor is compressed at all, however well it would have compressed.
        if (asset.identity.byteLength < 512) {
            expect(asset.brotli).toBeNull()
            expect(asset.gzip).toBeNull()
        }
        if (asset.brotli !== null) {
            compressed++
            // Brotli is what the negotiation prefers, so it must be the smaller of the two.
            if (asset.gzip !== null)
                expect(asset.brotli.byteLength).toBeLessThanOrEqual(asset.gzip.byteLength)
        }
        expect(name.length).toBeGreaterThan(0)
    }
    // The app is real, so at least the loader entry and the page chunk compressed.
    expect(compressed).toBeGreaterThan(0)
})

test('a DEV build ships identity only — compression is a production cost', async () => {
    const build = await buildClient({ pages: { '/': PAGE } })
    for (const asset of build.files.values()) {
        expect(asset.brotli).toBeNull()
        expect(asset.gzip).toBeNull()
    }
})

test('the chunk route serves brotli, gzip, or identity as the client asks', async () => {
    // ONE config object for both: the client build is memoised per config identity, so a second
    // `productionConfig()` would build a second app with different content hashes and every chunk URL
    // taken from it would 404 against this one.
    const config = productionConfig()
    const app = await createTestApp(config)
    try {
        const build = await buildClient(config)
        // Pick an asset the build actually compressed, so the negotiation has something to choose.
        let name = ''
        for (const [candidate, asset] of build.files)
            if (asset.brotli !== null && asset.gzip !== null) {
                name = candidate
                break
            }
        expect(name).not.toBe('')

        const brotli = await app.fetch(`/__abide/chunk/${name}`, {
            headers: { 'accept-encoding': 'br, gzip' },
        })
        expect(brotli.headers.get('content-encoding')).toBe('br')
        // A URL with more than one representation MUST say so, or a shared cache will hand brotli bytes
        // to a client that never asked for them.
        expect(brotli.headers.get('vary')).toContain('Accept-Encoding')
        const decoded = await brotli.text()
        expect(decoded.length).toBeGreaterThan(0)

        const gzip = await app.fetch(`/__abide/chunk/${name}`, {
            headers: { 'accept-encoding': 'gzip' },
        })
        expect(gzip.headers.get('content-encoding')).toBe('gzip')
        // Every encoding is the SAME resource — a client that decodes any of them sees identical bytes.
        expect(await gzip.text()).toBe(decoded)

        const identity = await app.fetch(`/__abide/chunk/${name}`, {
            headers: { 'accept-encoding': 'identity' },
        })
        expect(identity.headers.get('content-encoding')).toBeNull()
        expect(await identity.text()).toBe(decoded)

        // A weighted refusal is a refusal, not a preference: brotli is off the table here.
        const refused = await app.fetch(`/__abide/chunk/${name}`, {
            headers: { 'accept-encoding': 'br;q=0, gzip;q=1.0' },
        })
        expect(refused.headers.get('content-encoding')).toBe('gzip')

        // The immutable long-cache survives compression — the two policies are independent.
        expect(brotli.headers.get('cache-control')).toContain('immutable')
    } finally {
        await app.stop()
    }
})

test('a dev build advertises no variance at all', async () => {
    const config: AppConfig = { pages: { '/': PAGE } }
    const app = await createTestApp(config)
    try {
        const build = await buildClient(config)
        const response = await app.fetch(`/__abide/chunk/${build.entry}`, {
            headers: { 'accept-encoding': 'br, gzip' },
        })
        expect(response.status).toBe(200)
        expect(response.headers.get('content-encoding')).toBeNull()
        // No alternative representations exist, so `Vary` would only fragment caches for nothing.
        expect(response.headers.get('vary')).toBeNull()
    } finally {
        await app.stop()
    }
})

test('negotiateEncoding honours weights, wildcards, and refusals', () => {
    expect(negotiateEncoding('gzip, deflate, br', true, true)).toBe('br')
    expect(negotiateEncoding('gzip, deflate, br', false, true)).toBe('gzip')
    expect(negotiateEncoding('gzip, deflate, br', false, false)).toBe('identity')
    expect(negotiateEncoding(null, true, true)).toBe('identity')
    expect(negotiateEncoding('', true, true)).toBe('identity')
    expect(negotiateEncoding('identity', true, true)).toBe('identity')
    // An explicit weight beats the brotli-preferring tiebreak.
    expect(negotiateEncoding('br;q=0.2, gzip;q=0.9', true, true)).toBe('gzip')
    expect(negotiateEncoding('br;q=0.9, gzip;q=0.2', true, true)).toBe('br')
    // q=0 is a refusal on either encoding.
    expect(negotiateEncoding('br;q=0', true, true)).toBe('identity')
    expect(negotiateEncoding('br;q=0, gzip', true, true)).toBe('gzip')
    // A client asking only for brotli on an asset that has none falls to identity, not to gzip.
    expect(negotiateEncoding('br', false, true)).toBe('identity')
    // `*` supplies the weight for anything not named.
    expect(negotiateEncoding('*', true, true)).toBe('br')
    expect(negotiateEncoding('gzip;q=0.1, *;q=0.8', true, true)).toBe('br')
    expect(negotiateEncoding('*;q=0', true, true)).toBe('identity')
    // Casing and whitespace are not significant.
    expect(negotiateEncoding('  BR ;q=1.0 ', true, true)).toBe('br')
})

test('compressibility is a property of the format, not the route', () => {
    // Already-compressed containers are never re-compressed — the fonts abide itself ships are the
    // motivating case (each GROWS under gzip).
    expect(staticAssetType('inter-latin-var.woff2')?.compressible).toBe(false)
    expect(staticAssetType('/img/hero.png')?.compressible).toBe(false)
    expect(staticAssetType('clip.mp4')?.compressible).toBe(false)
    // …while their uncompressed cousins are.
    expect(staticAssetType('icons.svg')?.compressible).toBe(true)
    expect(staticAssetType('body.ttf')?.compressible).toBe(true)
    expect(staticAssetType('chime.wav')?.compressible).toBe(true)
    expect(staticAssetType('loader-abc123.js')?.compressible).toBe(true)

    // An unknown extension carries no claim either way, and a path with NO extension is not a file at
    // all — the distinction the two static routes act on differently.
    expect(staticAssetType('archive.tarball')).toEqual({
        extension: 'tarball',
        type: undefined,
        compressible: false,
    })
    expect(staticAssetType('/users/7')).toBeUndefined()
    expect(staticAssetType('/.well-known/thing')).toBeUndefined()
    expect(staticAssetType('trailing.')).toBeUndefined()
    // The extension is the last dot of the last SEGMENT — a dotted directory does not supply one.
    expect(staticAssetType('/v1.2/README')).toBeUndefined()
    expect(staticAssetType('/v1.2/notes.txt')?.type).toContain('text/plain')
})
