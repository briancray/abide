import { NO_STORE } from '../../shared/CACHE_CONTROL_VALUES.ts'
import { TEXT_PLAIN } from '../../shared/TEXT_PLAIN.ts'
import { acceptsZstd } from './acceptsZstd.ts'
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

  - `assets` (standalone compile): a map of request path → zstd bytes
    embedded into the binary.
  - `distDir` on disk (dev + `abide start`): files served straight from
    `dist`, with the precompressed `.zst` sibling set snapshotted once at
    boot so a zstd-capable client gets those bytes without on-the-fly
    compression.

Unlike the public server this answers every `/_app/` request itself (404 on
a miss — nothing falls through past the build tree). The path-traversal
guard inspects the raw request URL because the WHATWG parser normalizes
encoded `..` segments away before `url.pathname` is visible.
*/
export async function createAppAssetServer({
    distDir,
    assets,
}: {
    distDir: string
    assets?: Assets
}): Promise<(req: Request, url: URL) => Promise<Response>> {
    // Per-pathname asset header bundles, hashed-chunk-aware Cache-Control.
    const headersForAsset = createAssetHeaderCache(cacheControlForAsset)
    const diskZstdPaths = assets
        ? new Set<string>()
        : await globToPathSet(
              `${distDir}/_app`,
              '**/*.zst',
              (file) => `/_app/${file.replace(/\.zst$/, '')}`,
          )

    return async function serveAppAsset(req, url) {
        if (containsTraversal(req.url)) {
            return new Response('Not Found', {
                status: 404,
                headers: { 'Content-Type': TEXT_PLAIN, 'Cache-Control': NO_STORE },
            })
        }
        if (assets) {
            const compressed = assets[url.pathname]
            /* Miss-check before header work: the header cache keys on
               (request-controlled) pathnames, so building bundles for junk
               `/_app/*` probes would grow it without bound. */
            if (!compressed) {
                return new Response('Not Found', {
                    status: 404,
                    headers: { 'Content-Type': TEXT_PLAIN, 'Cache-Control': NO_STORE },
                })
            }
            return respondWithEmbeddedAsset(
                compressed,
                acceptsZstd(req),
                headersForAsset(url.pathname),
            )
        }
        const { base: baseHeaders, zstd: zstdHeaders } = headersForAsset(url.pathname)
        const diskPath = distDir + url.pathname
        if (acceptsZstd(req) && diskZstdPaths.has(url.pathname)) {
            return new Response(Bun.file(`${diskPath}.zst`), { headers: zstdHeaders })
        }
        return new Response(Bun.file(diskPath), { headers: baseHeaders })
    }
}
