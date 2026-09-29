/**
 * The attributes HTML reads by presence, written present or absent by the value's truthiness.
 *
 * 32.38 — THE ATTRIBUTES HTML READS BY PRESENCE, whose value is never looked at:
 * `disabled="false"` is a disabled button. So these, and only these, are written present or absent
 * by the value's truthiness. Every other attribute is written as its text — `aria-expanded="false"`
 * and `spellcheck="false"` mean something their absence does not. A leaf, because the compiler's
 * markup and the client's bindings both read it.
 */
export const BOOLEAN_ATTRIBUTES: ReadonlySet<string> = new Set([
    'allowfullscreen',
    'async',
    'autofocus',
    'autoplay',
    'checked',
    'controls',
    'default',
    'defer',
    'disabled',
    'formnovalidate',
    'hidden',
    'inert',
    'ismap',
    'itemscope',
    'loop',
    'multiple',
    'muted',
    'nomodule',
    'novalidate',
    'open',
    'playsinline',
    'readonly',
    'required',
    'reversed',
    'selected',
])
