/* A piece of a text node: literal characters, or a `{expr}` interpolation whose
   `code` is lowered and bound reactively. */
export type TextPart = { kind: 'static'; value: string } | { kind: 'expression'; code: string }
