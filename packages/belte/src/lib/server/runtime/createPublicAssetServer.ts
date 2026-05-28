import { containsTraversal } from './containsTraversal.ts'
import { mimeForExtension } from './mimeForExtension.ts'
import type { Assets } from './types/Assets.ts'

const PUBLIC_CACHE_CONTROL = 'public, max-age=3600'

/*
Serves files from the project's `public/` folder at the site root. Two
sources, picked at construction:

  - `publicAssets` (standalone compile): a map of root path → zstd bytes
    embedded into the binary, mirroring the `_app` asset embed.
  - `publicDir` on disk (dev + `belte start`): files read straight from
    `${cwd}/src/browser/public`.

Returns a server fn that resolves to `undefined` when no public file
matches the request path, so the caller falls through to its own 404 /
middleware path. The path-traversal guard mirrors serveStaticAsset's
defence against encoded `..` segments in the raw URL.
*/
export function createPublicAssetServer({
    publicDir,
    publicAssets,
}: {
    publicDir: string
    publicAssets?: Assets
}): (req: Request, url: URL) => Promise<Response | undefined> {
    const headerCache = new Map<string, { base: HeadersInit; zstd: HeadersInit }>()
    function headersFor(pathname: string): { base: HeadersInit; zstd: HeadersInit } {
        const cached = headerCache.get(pathname)
        if (cached) {
            return cached
        }
        const base: HeadersInit = {
            'Content-Type': mimeForExtension(pathname),
            Vary: 'Accept-Encoding',
            'Cache-Control': PUBLIC_CACHE_CONTROL,
        }
        const bundle = { base, zstd: { ...base, 'Content-Encoding': 'zstd' } }
        headerCache.set(pathname, bundle)
        return bundle
    }

    return async function servePublicAsset(req, url) {
        if (containsTraversal(req.url)) {
            return undefined
        }
        const wantsZstd = (req.headers.get('accept-encoding') ?? '').toLowerCase().includes('zstd')
        const { base, zstd } = headersFor(url.pathname)
        if (publicAssets) {
            const compressed = publicAssets[url.pathname]
            if (!compressed) {
                return undefined
            }
            if (wantsZstd) {
                return new Response(compressed, { headers: zstd })
            }
            return new Response(Bun.zstdDecompressSync(compressed), { headers: base })
        }
        const file = Bun.file(publicDir + url.pathname)
        if (!(await file.exists())) {
            return undefined
        }
        return new Response(file, { headers: base })
    }
}
