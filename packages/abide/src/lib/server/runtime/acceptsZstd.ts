/*
Whether the client advertised zstd in Accept-Encoding. Both static-asset
servers (the `/_app/` chunk server and the public/ server) gate their
pre-compressed responses on this, so the check lives in one place.
*/
export function acceptsZstd(req: Request): boolean {
    return (req.headers.get('accept-encoding') ?? '').toLowerCase().includes('zstd')
}
