/*
Serves one compile-time-embedded asset: a gzip-capable client gets the stored
bytes as-is, anyone else gets them decompressed on the fly. Shared by the
`_app` and public/ asset servers so the decompress fallback lives once.
*/
export function respondWithEmbeddedAsset(
    compressed: Uint8Array<ArrayBuffer>,
    wantsGzip: boolean,
    headers: { base: HeadersInit; gzip: HeadersInit },
): Response {
    if (wantsGzip) {
        return new Response(compressed, { headers: headers.gzip })
    }
    /* gunzipSync's Buffer is freshly allocated over a plain ArrayBuffer; @types/bun widens it to ArrayBufferLike, which BodyInit rejects. */
    return new Response(Bun.gunzipSync(compressed) as Uint8Array<ArrayBuffer>, {
        headers: headers.base,
    })
}
