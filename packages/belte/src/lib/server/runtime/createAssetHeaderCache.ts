import { mimeForExtension } from './mimeForExtension.ts'

/*
A static-asset response's headers depend only on its pathname (extension →
Content-Type, path → Cache-Control), so each distinct pathname's header bundle
is built once and reused across every hit on that chunk — avoiding a per-request
allocation on a cold page load that pulls dozens of files. Each bundle carries
the plain `base` headers plus a `zstd` variant with `Content-Encoding: zstd`.
`cacheControlFor` lets callers vary the policy: hashed-aware for `/_app/`,
fixed for public/.
*/
type AssetHeaderBundle = {
    base: HeadersInit
    zstd: HeadersInit
}

export function createAssetHeaderCache(
    cacheControlFor: (pathname: string) => string,
): (pathname: string) => AssetHeaderBundle {
    const cache = new Map<string, AssetHeaderBundle>()
    return function headersFor(pathname) {
        const cached = cache.get(pathname)
        if (cached) {
            return cached
        }
        const base: HeadersInit = {
            'Content-Type': mimeForExtension(pathname),
            Vary: 'Accept-Encoding',
            'Cache-Control': cacheControlFor(pathname),
        }
        const bundle: AssetHeaderBundle = { base, zstd: { ...base, 'Content-Encoding': 'zstd' } }
        cache.set(pathname, bundle)
        return bundle
    }
}
