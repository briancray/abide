/* The registered brand for trusted raw markup. `Symbol.for` resolves through the
   global registry, so this binding is the same symbol across module/bundle copies;
   `html` (`abide/ui/html`) imports it to brand, `rawHtmlString` reads it back. */
export const RAW_HTML = Symbol.for('abide.rawHtml')

/* A value marked as trusted raw markup — a `{expr}` interpolation inserts it
   verbatim (not escaped) on both sides. The brand is a registered Symbol, so it
   survives across module/bundle copies. Branded by `html` (`abide/ui/html`); read
   back by `rawHtmlString` here — the isomorphic reader both runtimes consume. */
export type RawHtml = { readonly [RAW_HTML]: string }

/* The raw markup of a `html`-branded value, or undefined for anything else
   (so text bindings can fast-path plain values and only branded ones go raw). */
// @documentation plumbing
export function rawHtmlString(value: unknown): string | undefined {
    return value !== null && typeof value === 'object' && RAW_HTML in value
        ? (value as RawHtml)[RAW_HTML]
        : undefined
}
