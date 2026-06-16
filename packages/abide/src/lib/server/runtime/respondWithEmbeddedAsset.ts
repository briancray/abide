/*
Serves one compile-time-embedded asset: a zstd-capable client gets the stored
bytes as-is, anyone else gets them decompressed on the fly. Shared by the
`_app` and public/ asset servers so the decompress fallback lives once.
*/
export async function respondWithEmbeddedAsset(
    compressed: Uint8Array<ArrayBuffer>,
    wantsZstd: boolean,
    headers: { base: HeadersInit; zstd: HeadersInit },
): Promise<Response> {
    if (wantsZstd) {
        return new Response(compressed, { headers: headers.zstd })
    }
    /* zstdDecompress's Buffer is freshly allocated over a plain ArrayBuffer; @types/bun widens it to ArrayBufferLike, which BodyInit rejects. */
    return new Response((await Bun.zstdDecompress(compressed)) as Uint8Array<ArrayBuffer>, {
        headers: headers.base,
    })
}
