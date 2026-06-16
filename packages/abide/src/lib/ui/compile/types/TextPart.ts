/* A piece of a text node: literal characters, or a `{expr}` interpolation whose
   `code` is lowered and bound reactively. `loc` is the absolute offset of the
   expression's first character in the original `.abide` source — present only
   when the parser was given the source's base offset; the runtime back-ends
   ignore it, the type-checking shadow maps diagnostics through it. */
export type TextPart =
    | { kind: 'static'; value: string }
    | { kind: 'expression'; code: string; loc?: number }
