// The word under a cursor, as both ends of the checker pipe read it.
//
// A leaf, and shared rather than restated, because the two copies GUARD EACH OTHER: `live.ts` sends
// the name it read off the author's text, `diagnosed.ts` reads the name at the position it landed on
// in the module, and it refuses the answer when the two differ. Written twice, a change to the
// character class on one side turns that guard from a check into a silent `null` — every hover and
// go-to-definition simply stops answering, with nothing red anywhere to say so.
//
// No imports of its own, and nothing but a string in and a string out: `diagnosed.ts` runs under
// NODE with types stripped rather than transformed, so anything this reached for would have to
// survive that too.

/** The characters an identifier is made of. Module scope: no `/g`, so there is no state to share. */
const WORD = /[A-Za-z0-9_$]/

/** The whole identifier an offset sits in, or `undefined` for anywhere that is not one. */
export function identifierAt(text: string, offset: number): string | undefined {
    if (!WORD.test(text[offset] ?? ' ')) return undefined
    let start = offset
    while (start > 0 && WORD.test(text[start - 1] as string)) start--
    let end = offset
    while (end < text.length && WORD.test(text[end] as string)) end++
    return text.slice(start, end)
}
