// Bun.build emits `[name]-[hash].[ext]` for chunks; hash is alnum and >=8 chars.
// Source maps inherit the same name (e.g. foo-abc12345.js.map), so the suffix may be `.map`.
const HASHED = /-[a-z0-9]{8,}\.[a-z0-9]+(\.map)?$/i

export function cacheControlForAsset(pathname: string): string {
    if (HASHED.test(pathname)) {
        return 'public, max-age=31536000, immutable'
    }
    return 'public, max-age=0, must-revalidate'
}
