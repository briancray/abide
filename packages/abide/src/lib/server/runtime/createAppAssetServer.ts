import { NO_STORE } from '../../shared/CACHE_CONTROL_VALUES.ts'
import { TEXT_PLAIN } from '../../shared/TEXT_PLAIN.ts'
import { acceptsGzip } from './acceptsGzip.ts'
import { cacheControlForAsset } from './cacheControlForAsset.ts'
import { containsTraversal } from './containsTraversal.ts'
import { createAssetHeaderCache } from './createAssetHeaderCache.ts'
import { globToPathSet } from './globToPathSet.ts'
import { respondWithEmbeddedAsset } from './respondWithEmbeddedAsset.ts'
import type { Assets } from './types/Assets.ts'

/*
Serves the build's `_app` assets (hashed chunks, css, sourcemaps). Two
sources, picked at construction — the sibling of createPublicAssetServer for
the framework-owned tree:

  - `assets` (standalone compile): a map of request path → gzip bytes
    embedded into the binary.
  - `distDir` on disk (dev + `abide start`): files served straight from
    `dist`, with the precompressed `.gz` sibling set snapshotted once at
    boot so a gzip-capable client gets those bytes without on-the-fly
    compression.

Unlike the public server this answers every `/_app/` request itself (404 on
a miss — nothing falls through past the build tree). The path-traversal
guard inspects the raw request URL because the WHATWG parser normalizes
encoded `..` segments away before `url.pathname` is visible.

`appDir` is the physical directory the `/_app/*` URLs map onto: `dist/_app` for
a production build, or — under `abide dev` — the generation dir this worker was
spawned on (`ABIDE_APP_DIR`). The URL space stays `/_app/*` either way; only the
disk location this worker reads from moves, so a rebuild's new worker reads a new
dir while this one keeps serving its own, immutable for its lifetime.
*/
export async function createAppAssetServer({
    appDir,
    assets,
}: {
    appDir: string
    assets?: Assets
}): Promise<(req: Request, url: URL) => Promise<Response>> {
    // Per-pathname asset header bundles, hashed-chunk-aware Cache-Control.
    const headersForAsset = createAssetHeaderCache(cacheControlForAsset)
    /* Boot snapshot of every disk chunk path (keyed by its `/_app/*` URL), mirroring
       createPublicAssetServer: the header cache keys on (request-controlled) pathnames,
       so building bundles for junk `/_app/*` probes would grow it without bound. A
       rebuild spawns a fresh worker (against a fresh generation dir), re-snapshotting. */
    const diskPaths = assets
        ? new Set<string>()
        : await globToPathSet(appDir, '**/*', (file) => `/_app/${file}`)
    /* Derive the precompressed `.gz` sibling set from the single tree scan (it already
       includes the `.gz` files) — a gzip-capable client gets those bytes without
       on-the-fly compression. Keyed by the base path (the `.gz` suffix stripped). */
    const diskGzipPaths = new Set(
        [...diskPaths].filter((path) => path.endsWith('.gz')).map((path) => path.slice(0, -3)),
    )

    // Fresh 404 per call — a Response body is single-use, so it can't be hoisted to a const.
    const notFound = (): Response =>
        new Response('Not Found', {
            status: 404,
            headers: { 'Content-Type': TEXT_PLAIN, 'Cache-Control': NO_STORE },
        })

    return async function serveAppAsset(req, url) {
        if (containsTraversal(req.url)) {
            return notFound()
        }
        /* Embed map and gzip Set hold decoded filesystem names; url.pathname stays
           percent-encoded — decode so a chunk/asset with a non-ASCII name matches and
           Bun.file opens the real path, not a literal `%xx` name. */
        let assetPath: string
        try {
            assetPath = decodeURIComponent(url.pathname)
        } catch {
            return notFound()
        }
        if (assets) {
            const compressed = assets[assetPath]
            /* Miss-check before header work: the header cache keys on
               (request-controlled) pathnames, so building bundles for junk
               `/_app/*` probes would grow it without bound. */
            if (!compressed) {
                return notFound()
            }
            return respondWithEmbeddedAsset(
                compressed,
                acceptsGzip(req),
                headersForAsset(assetPath),
            )
        }
        /* Miss-check before header work so probes for non-existent chunks can't grow the
           header cache (the embed branch above guards the same way). */
        if (!diskPaths.has(assetPath)) {
            return notFound()
        }
        const { base: baseHeaders, gzip: gzipHeaders } = headersForAsset(assetPath)
        // Map the `/_app/<file>` URL onto the physical dir: strip the `/_app` prefix
        // (5 chars) and join under appDir, which already IS the `_app` (or generation) dir.
        const diskPath = appDir + assetPath.slice('/_app'.length)
        if (acceptsGzip(req) && diskGzipPaths.has(assetPath)) {
            return new Response(Bun.file(`${diskPath}.gz`), { headers: gzipHeaders })
        }
        return new Response(Bun.file(diskPath), { headers: baseHeaders })
    }
}
