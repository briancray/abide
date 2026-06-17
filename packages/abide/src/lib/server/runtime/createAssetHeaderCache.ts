import { mimeForExtension } from './mimeForExtension.ts'

/*
A static-asset response's headers depend only on its pathname (extension →
Content-Type, path → Cache-Control), so each distinct pathname's header bundle
is built once and reused across every hit on that chunk — avoiding a per-request
allocation on a cold page load that pulls dozens of files. Each bundle carries
the plain `base` headers plus a `gzip` variant with `Content-Encoding: gzip`.
`cacheControlFor` lets callers vary the policy: hashed-aware for `/_app/`,
fixed for public/.
*/
type AssetHeaderBundle = {
    base: HeadersInit
    gzip: HeadersInit
}

export function createAssetHeaderCache(
    cacheControlFor: (pathname: string) => string,
): (pathname: string) => AssetHeaderBundle {
    const cache = new Map<string, AssetHeaderBundle>()
    return function headersFor(pathname) {
        return cache.getOrInsertComputed(pathname, () => {
            const base: HeadersInit = {
                'Content-Type': mimeForExtension(pathname),
                Vary: 'Accept-Encoding',
                'Cache-Control': cacheControlFor(pathname),
            }
            return { base, gzip: { ...base, 'Content-Encoding': 'gzip' } }
        })
    }
}
