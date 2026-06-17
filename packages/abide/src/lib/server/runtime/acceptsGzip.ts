/*
Whether the client advertised gzip in Accept-Encoding. The static-asset
servers and the dynamic-response gzip wrapper gate compressed output on this,
so the check lives in one place. Effectively always true for browsers and most
HTTP clients; a bare client that omits the header gets identity bytes.
*/
export function acceptsGzip(req: Request): boolean {
    const header = (req.headers.get('accept-encoding') ?? '').toLowerCase()
    /*
    Honour q-values: `gzip;q=0` is an explicit refusal even though the substring
    is present. Find the gzip (or wildcard) directive and reject only when its
    quality is zero.
    */
    const directives = header.split(',').map((part) => part.trim())
    // An explicit gzip directive wins over the wildcard; fall back to `*` otherwise.
    const directive =
        directives.find((part) => part === 'gzip' || part.startsWith('gzip;')) ??
        directives.find((part) => part === '*' || part.startsWith('*;'))
    if (directive === undefined) {
        return false
    }
    const quality = directive.match(/;\s*q=([\d.]+)/)
    return quality === null || Number(quality[1]) > 0
}
