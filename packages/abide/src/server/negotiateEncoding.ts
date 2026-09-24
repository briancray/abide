// 38.30 — WHICH OF THE ENCODINGS ON OFFER A REQUEST TAKES, or `undefined` for the bytes as they
// are. What is on offer is asked rather than assumed: a request preferring brotli for a file with
// only a gzip copy takes the gzip, where picking first and checking after would send it neither.
//
// The highest quality the request gives an encoding wins, a tie goes to the one offered first,
// and `q=0` is a refusal rather than a low preference — so `br;q=0, *` is gzip and `*;q=0` is
// nothing, which a parse that only looked for the token would get wrong both ways.

import { ENCODING_SUFFIX } from './CLIENT_BUILD.ts'
import { qualitiesOf } from './qualitiesOf.ts'

export type Encoding = keyof typeof ENCODING_SUFFIX

// Every encoding, in `ENCODING_SUFFIX`'s order — what a document rendered per request can offer.
export const ENCODINGS = Object.keys(ENCODING_SUFFIX) as Encoding[]

export function negotiateEncoding(
    accepted: string | null,
    offered: readonly Encoding[],
): Encoding | undefined {
    if (accepted === null) return undefined
    const qualities = qualitiesOf(accepted)
    const wildcard = qualities.get('*') ?? 0
    let chosen: Encoding | undefined
    let best = 0
    for (const encoding of offered) {
        const quality = qualities.get(encoding) ?? wildcard
        if (quality > best) {
            best = quality
            chosen = encoding
        }
    }
    return chosen
}
