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

/*
A diagnostic the shadow compiler raises itself (not from `tsc`), already located
in `.abide` source coordinates — `start`/`length` are an offset range in the
original file, so it needs no segment remap. Used for author rules the type
system can't express, e.g. importing a compiler-internal runtime helper.
*/
export type ShadowDiagnostic = { start: number; length: number; message: string }

export type CompiledShadow = {
    code: string
    mappings: ShadowMapping[]
    diagnostics?: ShadowDiagnostic[]
}
