// A run's dynamic part, on the CLIENT, where it is written through `data` rather than parsed.
// `escapeText` exists because markup is a parse; a text node's `data` is not one, so escaping
// here would put `&lt;` on the screen where the server put `<`.
//
// It is a named function rather than `String(...)` inline because the emitted run has to read the
// same on both sides: the server concatenates escaped pieces, the client concatenates raw ones,
// and a reader comparing the two modules should see one difference in one place.
export function escapeless(value: unknown): string {
    return value == null ? '' : String(value)
}
