// WHAT AN ATTRIBUTE EXPRESSION'S VALUE MEANS — one rule, for both substrates.
//
// `serverRuntime` builds an HTML string, `runtime` mutates a live DOM node. Those are genuinely
// different substrates and most of what each does is its own (`FORM_PROPERTY_NAMES` mirroring,
// `value`-as-property, CSSOM re-serialization). What is NOT its own is the classification that comes
// first — omit / bare / stringify, and whether a spread entry is an attribute at all — and each file
// stated it separately, connected only by comments saying "mirrors client `bindGroup`" and "Mirrors
// `renderServer.AttributeBuilder + applyAttributeValue`".
//
// The STATIC half was already unified for exactly this reason: `emitServer` runs the real
// `attrBuilder()` at emit time "so the baked literal is byte-identical to the builder path". The
// dynamic half was left as two spellings, and they had already disagreed.
//
// `<div {...props}>` with `props = { onClick: fn }`: the server dropped it (any function value is not
// an attribute), while the client's handler test was `/^on[a-z]/`, which `onClick` fails — so it fell
// through to `setAttribute('onClick', String(fn))` and wrote the function's SOURCE TEXT into the DOM.
// A browser then treats that as an inline `onclick` handler and EXECUTES it. SSR painted nothing; the
// hydrated page carried `onclick="(e) => {…}"`. The parity harness could not see it, because a
// spread-with-handler fixture is excluded from the client side.

export type AttributeDisposition =
    // `false` / `null` / `undefined` — the attribute is absent.
    | { kind: 'omit' }
    // `true` — present with an empty value.
    | { kind: 'bare' }
    // Anything else — its string form.
    | { kind: 'text'; text: string }

export function attributeDisposition(value: unknown): AttributeDisposition {
    if (value === false || value === null || value === undefined) return { kind: 'omit' }
    if (value === true) return { kind: 'bare' }
    return { kind: 'text', text: String(value) }
}

// A `class:`/`style:` directive is truthiness, not disposition — a `0` or `''` is off. Stated here so
// the two runtimes stop spelling the same falsy test twice.
export function directiveIsOn(condition: unknown): boolean {
    return Boolean(condition)
}

export function styleDirectiveApplies(value: unknown): boolean {
    return value !== false && value !== null && value !== undefined
}

// IS THIS SPREAD ENTRY A HANDLER RATHER THAN AN ATTRIBUTE? By the VALUE, never by the key.
//
// Keying on the name was the bug: a function is not a string and stringifying one into an attribute is
// never what an author meant, whatever the key is spelled like. The server already asked it this way;
// the client asked `/^on[a-z]/.test(key)` and stringified everything else. Each substrate still DOES
// its own thing with the answer — the server drops it (there is no live node to attach to), the client
// assigns it as a property, which is how `onclick` and friends wire up natively — but the answer is
// one.
export function isSpreadHandler(value: unknown): boolean {
    return typeof value === 'function'
}
