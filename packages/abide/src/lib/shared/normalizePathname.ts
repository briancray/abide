/*
The canonical slash form of a pathname: duplicate slashes collapsed, one
trailing slash stripped (except root) — so `//users/` canonicalizes to
`/users`. matchRoute matches this form on both sides, and the server 308s a
page request whose raw pathname differs (see createServer), so the app.handle
auth seam always guards exactly the string the matcher routes.
*/
export function normalizePathname(pathname: string): string {
    const collapsed = pathname.includes('//') ? pathname.replace(/\/{2,}/g, '/') : pathname
    return collapsed.length > 1 && collapsed.endsWith('/') ? collapsed.slice(0, -1) : collapsed
}
