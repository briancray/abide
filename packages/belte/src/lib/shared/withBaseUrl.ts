import { basePath } from './basePath.ts'

/*
Re-homes a URL under the mount base by prefixing its pathname (`/people` →
`/v2/people`) — the URL-level counterpart of withBase for sites that carry
whole URLs rather than rooted paths. Identity at root mount, so there is no
allocation (and no behaviour change) when no base is set.
*/
export function withBaseUrl(url: URL): URL {
    const base = basePath()
    if (!base) {
        return url
    }
    const prefixed = new URL(url)
    prefixed.pathname = base + url.pathname
    return prefixed
}
