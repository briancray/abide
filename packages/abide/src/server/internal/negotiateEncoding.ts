// Pick the `Content-Encoding` for a response, from the request's `Accept-Encoding` and which encodings
// are on offer (RFC 9110 §12.5.3).
//
// Availability is two booleans rather than the asset itself, because both compression paths ask the
// same question from different footing: a precompressed chunk offers only what the BUILD kept for it
// (an asset whose compressed form lost to its identity bytes offers nothing, and the negotiation
// collapses to identity), while dynamic compression can always produce either.
//
// Weights are honoured (`gzip;q=0.5, br;q=0.9`), `*` fills in for unnamed encodings, and a `q=0` is a
// REFUSAL, not a low preference — including `identity;q=0`, which is why the return is a union rather
// than a nullable: a client that refuses identity but named no encoding we hold still gets identity
// rather than a 406. Serving bytes a client tolerates beats failing a page over a header preference.
//
// Ties go to brotli: at equal weight it is the smaller of the two on every asset in a real build
// (179 KB vs 212 KB across the docs app's 62 chunks), so preferring it costs the client nothing.
export function negotiateEncoding(
    header: string | null,
    hasBrotli: boolean,
    hasGzip: boolean,
): 'br' | 'gzip' | 'identity' {
    if (!hasBrotli && !hasGzip) return 'identity'
    if (header === null || header === '') return 'identity'

    // -1 = the encoding was not named; `*` supplies the weight for anything left unnamed.
    let brotliWeight = -1
    let gzipWeight = -1
    let starWeight = -1
    let start = 0
    while (start <= header.length) {
        let end = header.indexOf(',', start)
        if (end === -1) end = header.length
        const part = header.slice(start, end)
        start = end + 1
        const semicolon = part.indexOf(';')
        const token = (semicolon === -1 ? part : part.slice(0, semicolon)).trim().toLowerCase()
        if (token === '') continue
        let weight = 1
        if (semicolon !== -1) {
            const params = part.slice(semicolon + 1)
            const q = params.indexOf('q=')
            if (q !== -1) {
                const parsed = Number.parseFloat(params.slice(q + 2))
                // A malformed weight is not a refusal — fall back to full acceptance rather than
                // silently dropping an encoding the client did ask for.
                weight = Number.isNaN(parsed) ? 1 : parsed
            }
        }
        if (token === 'br') brotliWeight = weight
        else if (token === 'gzip') gzipWeight = weight
        else if (token === '*') starWeight = weight
    }

    const brotli = hasBrotli ? (brotliWeight >= 0 ? brotliWeight : starWeight) : -1
    const gzip = hasGzip ? (gzipWeight >= 0 ? gzipWeight : starWeight) : -1
    if (brotli > 0 && brotli >= gzip) return 'br'
    if (gzip > 0) return 'gzip'
    return 'identity'
}
