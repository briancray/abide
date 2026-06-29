import { PUBLIC_ASSET_CACHE_CONTROL } from '../../shared/CACHE_CONTROL_VALUES.ts'
import { acceptsGzip } from './acceptsGzip.ts'
import { containsTraversal } from './containsTraversal.ts'
import { createAssetHeaderCache } from './createAssetHeaderCache.ts'
import { globToPathSet } from './globToPathSet.ts'
import { respondWithEmbeddedAsset } from './respondWithEmbeddedAsset.ts'
import type { Assets } from './types/Assets.ts'

/*
Serves files from the project's `public/` folder at the site root. Two
sources, picked at construction:

  - `publicAssets` (standalone compile): a map of root path → gzip bytes
    embedded into the binary, mirroring the `_app` asset embed.
  - `publicDir` on disk (dev + `abide start`): files read straight from
    `${cwd}/src/ui/public`, with the set of paths snapshotted once at
    boot (see below).

Returns a server fn that resolves to `undefined` when no public file
matches the request path, so the caller falls through to its own 404 /
middleware path. The path-traversal guard uses the same `containsTraversal`
check against encoded `..` segments in the raw URL.

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

    /*
    Existence is checked before any header work: every page nav and RPC
    falls through here on its way to the 404/middleware path, and the
    header cache keys on (request-controlled) pathnames — building bundles
    for misses would grow it without bound.
    */
    return async function servePublicAsset(req, url) {
        if (containsTraversal(req.url)) {
            return undefined
        }
        /* Both the embed map and the disk Set hold decoded filesystem names, but
           url.pathname stays percent-encoded — decode it so a file whose name has a
           space or non-ASCII char matches. A malformed escape can't name a real file. */
        let assetPath: string
        try {
            assetPath = decodeURIComponent(url.pathname)
        } catch {
            return undefined
        }
        if (publicAssets) {
            const compressed = publicAssets[assetPath]
            if (!compressed) {
                return undefined
            }
            return respondWithEmbeddedAsset(compressed, acceptsGzip(req), headersFor(assetPath))
        }
        if (!diskPaths.has(assetPath)) {
            return undefined
        }
        return new Response(Bun.file(publicDir + assetPath), {
            headers: headersFor(assetPath).base,
        })
    }
}
