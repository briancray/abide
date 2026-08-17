// `Accept-Encoding`, read once for both answerers.
//
// Here rather than in `$shared/internal/wire.ts`, where it started: `$shared` is what BOTH substrates
// need, and this has no client half and cannot have one — it is a SERVER deciding which form of a
// response to hand back. Both callers are in this directory (`assets.ts` for a built file,
// `layers.ts` for a streamed page), and neither the framework's server package nor `$shared` asks.
//
// It leaving also takes the edge with it: `assets.ts` imported nothing else from `wire.ts`, so a
// twenty-line header parser was putting the rpc argument encoder, the multipart body builder, the
// JSON-Schema query decoder and the NDJSON framer into the binary's eager graph — the mistake
// `internal/env.ts`'s header prices at ~6ms of the ~7ms that graph takes at all.

/** `q=0` in an `Accept-Encoding` parameter list. Hoisted: this runs per request that can compress. */
const REFUSED = /(^|;)\s*q\s*=\s*0(\.0*)?\s*(;|$)/i

/**
 * Which of `candidates` this caller accepts, as an index — `-1` for none, so identity.
 *
 * `candidates` is in the answerer's preference order and the LOWEST accepted index wins. The two
 * answerers rank differently and both are right: the built assets are ordered smallest-first out of
 * the build, and a streamed response has one compressor. What they cannot differ on is the reading of
 * the header, which is why that is here and not twice — `br;q=0` is a caller REFUSING brotli, and a
 * scan that only searched for the token would hand it exactly what it refused.
 *
 * ONE pass over the header rather than one per candidate: each token is cut, trimmed and lowered once
 * and then asked of the candidates, of which there are at most two.
 *
 * `*` is deliberately NOT read as an invitation. It means "anything you have", and answering it with
 * a compressed form is correct for a browser and wrong for the long tail of things that send it while
 * decoding only what they listed. A caller that wants a compressed form says which one, and identity
 * is always right — the one place a conservative reading costs bytes rather than correctness.
 */
export function acceptedEncoding(header: string | null, candidates: readonly string[]): number {
    if (header === null || candidates.length === 0) return -1
    let best = -1
    for (const part of header.split(',')) {
        const semi = part.indexOf(';')
        // Encoding tokens are case-insensitive, and `Accept-Encoding: BR` is legal even if nothing
        // sends it that way.
        const name = (semi < 0 ? part : part.slice(0, semi)).trim().toLowerCase()
        if (semi >= 0 && REFUSED.test(part.slice(semi))) continue
        for (let at = 0; at < candidates.length; at++) {
            if (candidates[at] === name && (best < 0 || at < best)) best = at
        }
    }
    return best
}
