import { textOf } from '#shared/Raw.ts'

// A run's dynamic part, on the CLIENT, where it is written through `data` rather than parsed.
// `escapeText` exists because markup is a parse; a text node's `data` is not one, so escaping
// here would put `&lt;` on the screen where the server put `<`.
//
// It is a named function rather than `String(...)` inline because the emitted run has to read the
// same on both sides: the server concatenates escaped pieces, the client concatenates raw ones,
// and a reader comparing the two modules should see one difference in one place.
//
// 32.28 — THE BRAND IS READ ON THIS SIDE TOO, so one `raw` answers on both. What a text node
// cannot do is parse it: a run is written through `data`, so a REACTIVE `{raw(x)}` re-renders its
// markup as text on the first binding run. Passing the html through is still the floor the clause
// asks for — the string matches the server's byte for byte, where `String(new Raw(…))` was
// `[object Object]` — and putting markup on screen from here needs a region rebuild a slot cannot
// ask for yet.
export { textOf as escapeless }
