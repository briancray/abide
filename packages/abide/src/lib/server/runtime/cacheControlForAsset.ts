import {
    IMMUTABLE_ASSET_CACHE_CONTROL,
    REVALIDATE_ASSET_CACHE_CONTROL,
} from '../../shared/CACHE_CONTROL_VALUES.ts'

/*
Bun.build emits `[name]-[hash].[ext]` for chunks; hash is alnum and >=8 chars.
Source maps inherit the same name (e.g. foo-abc12345.js.map), so the suffix may be `.map`.
*/
const HASHED = /-[a-z0-9]{8,}\.[a-z0-9]+(\.map)?$/i

/*
Returns the right `Cache-Control` for an asset path served under `/_app/`.
Hashed chunk filenames are content-addressed and immutable; everything else
(the entry bundle, the html shell, etc.) must revalidate every time.
*/
export function cacheControlForAsset(pathname: string): string {
    if (HASHED.test(pathname)) {
        return IMMUTABLE_ASSET_CACHE_CONTROL
    }
    return REVALIDATE_ASSET_CACHE_CONTROL
}
