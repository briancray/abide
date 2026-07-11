/*
Value tags for the ref-json codec (encodeRefJson / decodeRefJson). The output is
a `[rootValue, slots]` pair: `slots` holds only the hoisted CONTAINERS (objects,
arrays, Maps, Sets) addressed by index; every other value is encoded INLINE at its
position — a bare JSON primitive, or one of these tagged arrays. Primitives never
get their own slot, so a primitive-heavy payload stays close to plain-JSON size and
speed. A tag is always the first element of a JSON array at a value position; bare
JSON values are literal primitives, and plain objects only ever appear AS slots
(hoisted), so user data — even an object keyed `~r` or an array shaped like a tag —
can't collide with these. Shared between encoder and decoder so the tokens can't drift.
*/
export const REF_JSON_TAGS = {
    // ['~r', slotIndex] — reference to a hoisted container; breaks cycles, preserves shared identity.
    REF: '~r',
    // ['~a', ...values]
    ARRAY: '~a',
    // ['~m', [[keyValue, valValue], …]]
    MAP: '~m',
    // ['~s', [value, …]]
    SET: '~s',
    // ['~d', epochMs]
    DATE: '~d',
    // ['~x', source, flags]
    REGEXP: '~x',
    // ['~g', decimalString] — BigInt can't go through JSON natively.
    BIGINT: '~g',
    // ['~u'] — undefined (and functions/symbols, folded to it).
    UNDEFINED: '~u',
    // ['~n', token] — the numbers JSON flattens to null; the token is one of REF_JSON_NUMBER_TOKENS.
    NUMBER: '~n',
} as const

/*
The tokens carried by a `['~n', token]` tag — the numbers JSON can't represent. Shared by
`encodeRefJson`'s `numberToken` (produces them) and `decodeRefJson`'s `decodeNumberToken`
(parses them) so the wire form can't drift between the two ends.
*/
export const REF_JSON_NUMBER_TOKENS = {
    NAN: 'NaN',
    INFINITY: 'Infinity',
    NEG_INFINITY: '-Infinity',
    NEG_ZERO: '-0',
} as const
