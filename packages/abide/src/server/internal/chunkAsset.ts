// The content-addressed client asset route class (`/__abide/chunk/<name>-<hash>.(js|css)`, TODO #6):
// the code-split loader entry, the per-route chunks, the shared chunks, and the bundled CSS, each served
// by its content-hashed filename. Every name embeds a content hash, so the response is immutable and
// long-cacheable; `renderDocument` injects the loader's hashed URL and modulepreloads the rest.
//
// THE ONE ROUTE CLASS THAT IS NOT TRACED, and the only one that opts out of the identity-scoped
// `Cache-Control` default: a static byte response with no handler, no identity, and an immutable
// long-cache. Minting a trace id per chunk fetch would spend entropy and two response headers on
// something no span will ever join, and the immutable bytes are shared across users, so a per-request
// header on them is a lie. `router.ts` skips the mint for this prefix; the exemption is stated there
// because that is where the mint happens.
//
// A production build DOES vary this on `Accept-Encoding` (precompressed brotli/gzip), which is not a
// per-request header in that sense: it selects among fixed representations of the same content-addressed
// bytes and stays identity-free, so the response is still shared across every client that negotiates
// alike.

import type { AppConfig } from './appConfig.ts'
import { CHUNK_PREFIX } from './CHUNK_PREFIX.ts'
import { clientBuildFor } from './clientBundle.ts'
import { compressionMode } from './compressionMode.ts'
import { errorResponse } from './errorResponse.ts'
import { negotiateEncoding } from './negotiateEncoding.ts'
import type { RequestScope } from './requestScope.ts'
import { staticAssetType } from './staticAssetType.ts'

export async function handleChunkAsset(scope: RequestScope, config: AppConfig): Promise<Response> {
    const url = scope.route.url
    // This route is the one that still needs the VERB after the gate: it builds the body itself, so it
    // has to drop it for HEAD (and state `Content-Length` for the representation a GET would have
    // returned). Everywhere else the method gate is the only reader of the method.
    const method = scope.request.method.toUpperCase()
    const name = url.pathname.slice(CHUNK_PREFIX.length)
    const build = await clientBuildFor(config)
    const asset = build.files.get(name)
    if (asset === undefined) return errorResponse(404, `Not found: ${url.pathname}`)
    const contentType = staticAssetType(name)?.type ?? 'text/javascript; charset=utf-8'
    const headers: Record<string, string> = {
        'content-type': contentType,
        // Content-addressed → the bytes for this URL never change; cache aggressively.
        'cache-control': 'public, max-age=31536000, immutable',
    }
    // A production build precompresses this asset; dev serves identity only, and `ABIDE_COMPRESS=off`
    // withholds the variants a build did produce. `Vary` is stamped only when the URL genuinely has more
    // than one representation — an incompressible asset answers identically to every client, so
    // advertising variance would split cache entries for nothing.
    const offered = compressionMode() !== 'off'
    const hasBrotli = offered && asset.brotli !== null
    const hasGzip = offered && asset.gzip !== null
    const encoding = negotiateEncoding(
        scope.request.headers.get('accept-encoding'),
        hasBrotli,
        hasGzip,
    )
    let body = asset.identity
    if (hasBrotli || hasGzip) {
        headers.vary = 'Accept-Encoding'
        if (encoding === 'br' && asset.brotli !== null) {
            headers['content-encoding'] = 'br'
            body = asset.brotli
        } else if (encoding === 'gzip' && asset.gzip !== null) {
            headers['content-encoding'] = 'gzip'
            body = asset.gzip
        }
    }
    // HEAD is GET minus the body, but its `Content-Length` must still describe the representation that a
    // GET would return — so it is stated explicitly rather than left to the empty body.
    if (method === 'HEAD') headers['content-length'] = String(body.byteLength)
    return new Response(method === 'HEAD' ? null : body, { status: 200, headers })
}
