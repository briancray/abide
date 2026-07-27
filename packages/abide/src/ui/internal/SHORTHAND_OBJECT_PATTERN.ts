// A destructure of nothing but shorthand identifiers — `{ a }`, `{ a, b }`, with an optional trailing
// comma. Deliberately narrow: a default (`{ a = 1 }`), a rename (`{ a: b }`), a rest (`{ ...rest }`),
// a nested pattern or an array pattern all fail this and take the general path in its callers, where
// the real destructuring syntax does the work rather than this regex trying to reimplement it.
export const SHORTHAND_OBJECT_PATTERN =
    /^\{\s*[A-Za-z_$][\w$]*(?:\s*,\s*[A-Za-z_$][\w$]*)*\s*,?\s*\}$/
