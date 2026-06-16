/*
The type-checking shadow of a `.abide` component: a synthetic `.ts` module that
reconstructs the author-facing scope with value types and references every
template expression in a checkable position, plus the segment map that relocates
a diagnostic in the shadow back to the original `.abide` source.

Each mapping covers one verbatim-emitted span: `length` characters at `shadowStart`
in the shadow correspond to the same `length` characters at `sourceStart` in the
`.abide` file (expressions are emitted unchanged, so the spans are equal length).
A shadow offset inside a mapping translates to `sourceStart + (offset - shadowStart)`;
an offset in no mapping is synthesised scaffolding and its diagnostic is dropped.
*/
export type ShadowMapping = { shadowStart: number; sourceStart: number; length: number }

export type CompiledShadow = { code: string; mappings: ShadowMapping[] }
