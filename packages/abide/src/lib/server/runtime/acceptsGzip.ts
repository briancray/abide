/*
Whether the client advertised gzip in Accept-Encoding. The static-asset
servers and the dynamic-response gzip wrapper gate compressed output on this,
so the check lives in one place. Effectively always true for browsers and most
HTTP clients; a bare client that omits the header gets identity bytes.
*/
export function acceptsGzip(req: Request): boolean {
    return (req.headers.get('accept-encoding') ?? '').toLowerCase().includes('gzip')
}
