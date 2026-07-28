// A target origin with no trailing slash, so `${origin}/__abide/rpc/x` never doubles it.
export function normalizeOrigin(url: string): string {
    return url.endsWith('/') ? url.slice(0, -1) : url
}
