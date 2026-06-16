const RAW_HTML = Symbol.for('abide.rawHtml')

/* A value marked as trusted raw markup — a `{expr}` interpolation inserts it
   verbatim (not escaped) on both sides. The brand is a registered Symbol, so it
   survives across module/bundle copies. */
export type RawHtml = { readonly [RAW_HTML]: string }

/*
Marks a string as trusted raw HTML so a `{expr}` interpolation inserts its nodes
instead of escaped text — the abide idiom for raw markup (no `{@html}` mustache).
Works two ways:

  html(trustedString)        // plain call — insert the string verbatim
  html`<b>${name}</b>`       // tagged — concatenate parts verbatim

Calling `html` is the explicit opt-in to raw insertion; plain `{value}` always
escapes. The tag does NOT auto-escape interpolations (it's raw by intent), so only
build markup from values you trust, or escape them yourself.
*/
// @readme plumbing
export function html(strings: TemplateStringsArray | string, ...values: unknown[]): RawHtml {
    if (typeof strings === 'string') {
        return { [RAW_HTML]: strings }
    }
    let markup = strings[0] ?? ''
    for (let index = 0; index < values.length; index += 1) {
        markup += String(values[index]) + (strings[index + 1] ?? '')
    }
    return { [RAW_HTML]: markup }
}

/* The raw markup of a `html`-branded value, or undefined for anything else
   (so text bindings can fast-path plain values and only branded ones go raw). */
export function rawHtmlString(value: unknown): string | undefined {
    return value !== null && typeof value === 'object' && RAW_HTML in value
        ? (value as RawHtml)[RAW_HTML]
        : undefined
}
