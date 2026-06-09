import { NO_STORE } from '../../shared/CACHE_CONTROL_VALUES.ts'
import { acceptsZstd } from './acceptsZstd.ts'
import { cacheControlForAsset } from './cacheControlForAsset.ts'
import { containsTraversal } from './containsTraversal.ts'
import { createAssetHeaderCache } from './createAssetHeaderCache.ts'
import { globToPathSet } from './globToPathSet.ts'
import type { Assets } from './types/Assets.ts'

/*
Serves the build's `_app` assets (hashed chunks, css, sourcemaps). Two
sources, picked at construction — the sibling of createPublicAssetServer for
the framework-owned tree:

  - `assets` (standalone compile): a map of request path → zstd bytes
    embedded into the binary.
  - `distDir` on disk (dev + `belte start`): files served straight from
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
                headers: { 'Cache-Control': NO_STORE },
            })
        }
        const wantsZstd = acceptsZstd(req)
        const { base: baseHeaders, zstd: zstdHeaders } = headersForAsset(url.pathname)
        if (assets) {
            const compressed = assets[url.pathname]
            if (!compressed) {
                return new Response('Not Found', {
                    status: 404,
                    headers: { 'Cache-Control': NO_STORE },
                })
            }
            if (wantsZstd) {
                return new Response(compressed, { headers: zstdHeaders })
            }
            return new Response(await Bun.zstdDecompress(compressed), { headers: baseHeaders })
        }
        const diskPath = distDir + url.pathname
        if (wantsZstd && diskZstdPaths.has(url.pathname)) {
            return new Response(Bun.file(`${diskPath}.zst`), { headers: zstdHeaders })
        }
        return new Response(Bun.file(diskPath), { headers: baseHeaders })
    }
}
