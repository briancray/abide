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
//
// `BRANCHES` and `BINDABLE` are neither. They are the two CLOSED SETS of the template language, and
// they are here so that the pages claiming to document all of them can be checked against the tables
// that DECIDE them rather than against a second list kept by hand beside them. One reader —
// `dogfood/test/docs.test.ts` — because this door pulls TypeScript's scanner and a page may not.

import type { Shapes } from '#shared/internal/shapes.ts'
import type { Kind } from '#shared/transport.ts'
import { type Endpoint, endpointId, endpointsOf, kindOf, registration, stub } from './internal/elide.ts'
import { emit } from './internal/emit.ts'
import { SyntaxError_ } from './internal/lex.ts'
import { positionAt, type Segment, sourceMap, startsOf } from './internal/map.ts'
import { parse } from './internal/parse.ts'
import type { TypeSource } from './internal/shape.ts'

// `Method` deliberately stays internal: the compiler's is a DECLARATION keyword — it includes
// `socket` — and `abide` already exports a `Method` that is the HTTP verb a call travels as.
// `Kind` comes straight from `#shared`, the way `compiler/shapes.ts` takes it: it is the runtime's
// own name for what an endpoint is, and a hop through `elide.ts` would put a file that does not
// declare it between the two.
export type { Kind } from '#shared/transport.ts'
export { ElisionError, type Endpoint, endpointId, kindOf } from './internal/elide.ts'
export { SHAPES_FILE } from './SHAPES_FILE.ts'
export { TRANSPORT_MODULE } from './TRANSPORT.ts'

export { BINDABLE } from './internal/emit.ts'
export { original as originalPosition, type Segment } from './internal/map.ts'
export { BRANCHES, ParseError } from './internal/parse.ts'
export type { ImportedModule, TypeSource } from './internal/shape.ts'

export interface CompileOptions {
    /** Names the default export and every diagnostic. */
    filename?: string
    /**
     * The text of a module this one imports its PROPS TYPE from — the same option `elide` takes, for
     * the same reason and with the same guarantee: injected rather than reached for, so this stays
     * text in, text out.
     *
     * A prop's kind is read off the member's declaration TEXT, so an imported type needed the other
     * file's bytes and nothing more. Absent, an imported type classifies as it always has — every
     * member a cell — which is the degradation, not an error.
     */
    resolve?: TypeSource
}

export interface Compiled {
    code: string
    /** A v3 source map with the `.abide` file inlined. Encoded on first read, then held. */
    map: string
    /** The same mapping, unencoded — what `abide check` moves a diagnostic through. */
    segments: Segment[]
}

export function compile(source: string, options: CompileOptions = {}): Compiled {
    const filename = options.filename ?? 'Component.abide'
    const blocks = parse(source)
    const { code, segments } = emit(source, blocks, { filename, resolve: options.resolve })
    const base = filename.split('/').pop() ?? filename
    // Encoded ON DEMAND. `plugin.ts` reads only `code`, and it is the caller that runs per `.abide`
    // file per bundle — the dev server re-bundles a route on every document request — while VLQ
    // encoding every segment and inlining the whole source is the expensive half of a compile.
    let encoded: string | null = null
    return {
        code,
        segments,
        get map(): string {
            encoded ??= sourceMap(segments, base, source)
            return encoded
        },
    }
}

/** Line and column for a diagnostic position, so an error names a place in the file. One-based. */
export function locate(source: string, position: number): { line: number; column: number } {
    const at = positionAt(startsOf(source), position)
    return { line: at.line + 1, column: at.column + 1 }
}

export interface ElideOptions {
    /** Names the addresses and every diagnostic — the module path IS the address. */
    filename: string
    /** The browser lane, which gets the stub instead of the module. */
    browser?: boolean
    /**
     * The text of a module this one imports a TYPE from, so a shape declared elsewhere is still
     * published. Injected rather than reached for: this function does no I/O, which is what lets a
     * demo case assert an elided module the same way it asserts a rendered one — and what lets one
     * run in a browser, where the resolver is a map in memory.
     *
     * Consulted lazily and only in the server lane, because only the registration carries shapes.
     */
    resolve?: TypeSource
    /**
     * Shapes the real CHECKER derived, by endpoint address — `abide/compiler/shapes`.
     *
     * They only ever UPGRADE: an endpoint absent here keeps what the tokens said, which is the whole
     * of the staleness story. A shape this pass is behind on is one that knows LESS, and knowing less
     * is the direction a derived shape is already allowed to be wrong in.
     */
    shapes?: Record<string, Shapes>
}

export interface Elided {
    /** The stub, or the module plus its own registration. */
    code: string
    kind: Kind
    endpoints: Endpoint[]
}

/**
 * A transport module for one lane. `null` for a file under neither transport directory, which is
 * what lets a caller ask about any file at all.
 *
 * The same pass over the same text produces both lanes, so the browser's stub and the server's
 * registration cannot disagree about what an endpoint is called or where it is served.
 */
export function elide(source: string, options: ElideOptions): Elided | null {
    const kind = kindOf(options.filename)
    if (kind === null) return null
    // The resolver is withheld from the browser lane rather than merely unused there: the stub
    // carries no shapes, so the lane that throws the module away must also do none of the reads.
    const endpoints = endpointsOf(
        source,
        options.filename,
        kind,
        options.browser === true ? undefined : options.resolve,
    )
    // Applied here rather than inside `endpointsOf`, so the one place that knows an endpoint's
    // ADDRESS is the one place that matches a checker's answer to it.
    const better = options.shapes
    if (better !== undefined && options.browser !== true) {
        for (const endpoint of endpoints) {
            const known = better[endpointId(options.filename, endpoint.name)]
            if (known === undefined) continue
            // Assigned, never ADDED: `shapesAt` writes both fields on every endpoint it builds, so
            // a checker's better answer overwrites a field that is already there rather than growing
            // the record mid-loop.
            if (known.input !== undefined) endpoint.input = known.input
            if (known.output !== undefined) endpoint.output = known.output
        }
    }
    const code =
        options.browser === true
            ? stub(options.filename, kind, endpoints)
            : source + registration(options.filename, kind, endpoints)
    return { code, kind, endpoints }
}

export function describe(source: string, filename: string, error: unknown): string {
    // `ParseError` and `ElisionError` are both `SyntaxError_`, so one guard places all three — and
    // that guard is also what narrows to the `position` below.
    if (!(error instanceof SyntaxError_)) return String(error)
    const { line, column } = locate(source, error.position)
    return `${filename}:${line}:${column} ${error.message}`
}
