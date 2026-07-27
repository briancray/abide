import { join, resolve, sep } from 'node:path'
import { staticAssetType } from './staticAssetType.ts'

// `src/ui/public/**` — files served VERBATIM at their literal request path (`src/ui/public/fonts/x.woff2`
// → `GET /fonts/x.woff2`). This is the counterpart to the content-addressed `/__abide/chunk/` route, and
// the two exist for opposite reasons: a chunk's URL embeds a content hash, so it can be `immutable` and
// is only ever discovered through the build; a public file sits at a FIXED, externally-known path
// (`/favicon.ico`, `/robots.txt`, a font a stylesheet names, an `/og-image.png` a crawler fetches) and
// therefore can NOT be content-addressed — a hashed `favicon.a3f9.ico` is unreachable when the consumer
// is going to ask for `/favicon.ico` regardless. Fixed path ⇒ revalidated, not immutable.
//
// Returns undefined when nothing matches, so the router falls through to page/RPC routing — a public
// file never shadows a route it does not literally name.
export async function servePublicFile(
    dir: string,
    pathname: string,
    request: Request,
): Promise<Response | undefined> {
    // A public asset is always an absolute, non-root path. Anything else is not ours to answer.
    if (!pathname.startsWith('/') || pathname === '/') return undefined

    // Percent-decode before touching the filesystem — a request for `/fonts/a%20b.woff2` names the file
    // `a b.woff2`. Malformed encoding is a rejected request, not a 500.
    let decoded: string
    try {
        decoded = decodeURIComponent(pathname)
    } catch {
        return undefined
    }
    // A NUL byte truncates the path in some syscalls, so a name containing one can address a DIFFERENT
    // file than the one validated below. Refuse it outright rather than normalise it.
    if (decoded.includes('\0')) return undefined

    const publicDir = resolve(join(dir, 'src/ui/public'))
    // `resolve` collapses `..` — the containment check below is what actually stops traversal, and it
    // compares the RESOLVED path (so `/fonts/../../app.ts` is caught after normalisation, not before).
    const target = resolve(join(publicDir, decoded))
    if (target !== publicDir && !target.startsWith(publicDir + sep)) return undefined

    // Resolve the content type BEFORE touching the filesystem: an extensionless path is never a public
    // file (it is a page route), so this rejects it without a syscall. It also skips directories, which
    // report `exists()` on some platforms but would throw on read.
    const resolved = staticAssetType(target)
    if (resolved === undefined) return undefined
    const contentType = resolved.type ?? 'application/octet-stream'

    const file = Bun.file(target)
    if (!(await file.exists())) return undefined

    // Weak validator from size + mtime: strong enough to skip a re-download, cheap enough to compute per
    // request without hashing the bytes. Fonts and images are the common case and both are large.
    const etag = `W/"${file.size.toString(36)}-${Math.floor(file.lastModified).toString(36)}"`
    // A fixed-path asset CAN change, so it revalidates rather than caching immutably. Declaring
    // `cache-control` here also opts the response out of the router's identity-scoped
    // `private, no-cache` + `Vary: Cookie` default — a public file is shared across users by definition.
    const headers: Record<string, string> = {
        'content-type': contentType,
        etag,
        'cache-control': 'public, max-age=3600, must-revalidate',
    }
    // Method check BEFORE revalidation: a `POST` carrying a stale-but-matching `If-None-Match` is still
    // a method error, and answering it 304 would tell the caller its unsupported request succeeded.
    const method = request.method.toUpperCase()
    if (method !== 'GET' && method !== 'HEAD') {
        return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } })
    }
    if (request.headers.get('if-none-match') === etag) {
        return new Response(null, { status: 304, headers })
    }
    // HEAD is GET minus the body (the router derives it the same way for RPCs); Bun sets content-length
    // from the BunFile either way.
    return new Response(method === 'HEAD' ? null : file, { status: 200, headers })
}
