/**
 * A run of ASCII whitespace, which is what a `class` value is split into tokens on — read by the
 * compiler finding the classes a static `class` holds and by the runtime writing a `class={expr}`'s
 * tokens (32.71), so both split one way — and what an `<option>`'s text collapses and trims, where
 * a no-break space is text the browser keeps.
 */
export const ASCII_WHITESPACE = /[\t\n\f\r ]+/
