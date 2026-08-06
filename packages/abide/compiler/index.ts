// The compiler's whole public surface: one pure function, and what a caller needs to REPORT what it
// did.
//
// No filesystem, no resolver, no cache — `compile` takes text and returns text, which is what lets a
// demo case assert an emitted file the same way it asserts a rendered one. The Bun plugin and the
// check lane are thin shells over this, and neither has any compiling of its own.
//
// The rest is diagnostics, and it is here because both shells need it and neither may reach into
// `internal/` to get it: `describe`/`locate` turn a thrown position into a place in the file, and
// `originalPosition`/`Segment` move a position the other way, from emitted code back to the
// `.abide` source. `ParseError` is exported so a caller can tell a compile failure from any other
// throw — `SyntaxError_` deliberately is not, because a lexer error is one the shells only format.

import { emit } from './internal/emit.ts'
import { SyntaxError_ } from './internal/lex.ts'
import { positionAt, type Segment, sourceMap, startsOf } from './internal/map.ts'
import { ParseError, parse } from './internal/parse.ts'

export { original as originalPosition, type Segment } from './internal/map.ts'
export { ParseError } from './internal/parse.ts'

export interface CompileOptions {
    /** Names the default export and every diagnostic. */
    filename?: string
}

export interface Compiled {
    code: string
    /** A v3 source map with the `.abide` file inlined. */
    map: string
    /** The same mapping, unencoded — what `abide check` moves a diagnostic through. */
    segments: Segment[]
}

export function compile(source: string, options: CompileOptions = {}): Compiled {
    const filename = options.filename ?? 'Component.abide'
    const blocks = parse(source)
    const { code, segments } = emit(source, blocks, { filename })
    const base = filename.split('/').pop() ?? filename
    return { code, map: sourceMap(segments, base, source), segments }
}

/** Line and column for a diagnostic position, so an error names a place in the file. One-based. */
export function locate(source: string, position: number): { line: number; column: number } {
    const at = positionAt(startsOf(source), position)
    return { line: at.line + 1, column: at.column + 1 }
}

export function describe(source: string, filename: string, error: unknown): string {
    if (!(error instanceof SyntaxError_) && !(error instanceof ParseError)) return String(error)
    const { line, column } = locate(source, error.position)
    return `${filename}:${line}:${column} ${error.message}`
}
