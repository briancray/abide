import { PUBLIC_ASSET_CACHE_CONTROL } from '../../shared/cacheControlValues.ts'
import { acceptsZstd } from './acceptsZstd.ts'
import { containsTraversal } from './containsTraversal.ts'
import { createAssetHeaderCache } from './createAssetHeaderCache.ts'
import { globToPathSet } from './globToPathSet.ts'
import type { Assets } from './types/Assets.ts'

/*
Serves files from the project's `public/` folder at the site root. Two
sources, picked at construction:

  - `publicAssets` (standalone compile): a map of root path → zstd bytes
    embedded into the binary, mirroring the `_app` asset embed.
  - `publicDir` on disk (dev + `belte start`): files read straight from
    `${cwd}/src/browser/public`, with the set of paths snapshotted once at
    boot (see below).

Returns a server fn that resolves to `undefined` when no public file
matches the request path, so the caller falls through to its own 404 /
middleware path. The path-traversal guard mirrors serveStaticAsset's
defence against encoded `..` segments in the raw URL.

Async because disk mode globs `publicDir` once at construction to build a
Set of the available paths: every page nav and RPC falls through here, so
a Set lookup beats a filesystem stat per miss. A file added to public/
after boot needs a server restart to be seen — the same restart a code
change already triggers under `bun --watch`.
*/
export async function createPublicAssetServer({
    publicDir,
    publicAssets,
}: {
    publicDir: string
    publicAssets?: Assets
}): Promise<(req: Request, url: URL) => Promise<Response | undefined>> {
    const headersFor = createAssetHeaderCache(() => PUBLIC_ASSET_CACHE_CONTROL)
    // `dot: true` keeps dotfiles (e.g. `.well-known/…`) servable, matching a raw disk stat.
    const diskPaths = publicAssets
        ? new Set<string>()
        : await globToPathSet(publicDir, '**/*', (file) => `/${file}`, { dot: true })

    return async function servePublicAsset(req, url) {
        if (containsTraversal(req.url)) {
            return undefined
        }
        const wantsZstd = acceptsZstd(req)
        const { base, zstd } = headersFor(url.pathname)
        if (publicAssets) {
            const compressed = publicAssets[url.pathname]
            if (!compressed) {
                return undefined
            }
            if (wantsZstd) {
                return new Response(compressed, { headers: zstd })
            }
            return new Response(await Bun.zstdDecompress(compressed), { headers: base })
        }
        if (!diskPaths.has(url.pathname)) {
            return undefined
        }
        return new Response(Bun.file(publicDir + url.pathname), { headers: base })
    }
}
