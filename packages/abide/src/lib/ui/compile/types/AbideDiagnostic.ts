import type ts from 'typescript'

/*
A type-check diagnostic relocated onto a `.abide` source file: `start`/`length`
are an offset range in the original component file (not the shadow), ready for a
CLI to render or the LSP to convert to a line/character range.
*/
export type AbideDiagnostic = {
    file: string
    start: number
    length: number
    message: string
    category: ts.DiagnosticCategory
}
