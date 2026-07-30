// Mapping a tsgo diagnostic on a GENERATED module back to a position in the `.abide` it came from.
//
// Both type lanes do this — `abide check` over a whole project, the LSP per keystroke over the open
// documents — and they hand-rolled it separately, which is how they came to disagree. The step looks
// trivial (look the module up by filename, map the offset) and has two traps, both of which fail
// SILENTLY by dropping the diagnostic rather than by throwing:
//
//   1. CASE. tsgo canonicalizes the path it reports on a case-insensitive filesystem, so a generated
//      name carrying any uppercase — a `MyWidget.abide`, or any project under a path like
//      `/Users/…/Code/` — can come back in a different case than it went in. A case-sensitive lookup
//      misses and the diagnostic vanishes, so `abide check` reports GREEN on a file with type errors.
//      `lsp.ts` hit this and keyed lowercase; `check.ts` never learned, because there were two copies.
//   2. THE HEADER. Every generated module opens with a synthetic preamble. A diagnostic inside it is
//      not the author's code and must not be reported against their file at a mapped-back offset that
//      means nothing.
//
// So the index and the lookup are ONE thing here, and callers cannot build the map with the wrong
// keying — `indexByGeneratedPath` is the only way to get a map the lookups accept, which is now a TYPE
// (`GeneratedIndex`, branded) rather than a claim in this comment. It was the claim for a while, and the
// claim was false; see the note on the brand below.
// Formatting is deliberately left out: the two lanes emit different diagnostic shapes (a CLI record vs
// an LSP `Diagnostic`), and that is a real difference, unlike this.

import { CHECK_HEADER_LENGTH, mapGenToOrig, type Segment } from './emitCheck.ts'

// A tsgo diagnostic as both lanes read it off the API. Declared once — it was two identical private
// copies, one per lane.
export interface RawDiagnostic {
    file: string
    pos: number
    code: number
    text: string
}

// The minimum a lane's per-module record must carry to be mapped back. Both lanes' records are wider
// (the LSP's also drives hover and go-to-definition); this is the part this module needs.
export interface GeneratedModule {
    abidePath: string
    tsPath: string
    source: string
    segments: Segment[]
}

// A map keyed the way tsgo will report — and BRANDED, so `indexByGeneratedPath` is structurally the only
// way to produce one. The claim above ("callers cannot build the map with the wrong keying") was a
// comment, and it was false: the lookups took a bare `Map<string, M>`, so `lsp.ts` rebuilt the index
// inline — `new Map(modules.map((m) => [m.tsPath.toLowerCase(), m]))` — in two of its handlers, and one of
// its comments described a sharing of `byTs` that did not exist (the shared one is a `const` inside
// `refresh()`). Trap (1) fails by DROPPING a result, so re-keying would have fixed diagnostics and left
// go-to-definition and find-references quietly broken.
declare const GENERATED_INDEX: unique symbol

export type GeneratedIndex<M extends GeneratedModule> = Map<string, M> & {
    readonly [GENERATED_INDEX]: true
}

export function indexByGeneratedPath<M extends GeneratedModule>(
    modules: Iterable<M>,
): GeneratedIndex<M> {
    const index = new Map<string, M>()
    for (const module of modules) index.set(module.tsPath.toLowerCase(), module)
    // The one cast: the brand is a type-level marker with no runtime member, which is what makes it free.
    return index as GeneratedIndex<M>
}

// Resolve a raw diagnostic to its `.abide` module and 1-based line/column. `undefined` means "not the
// author's code" — either the diagnostic is on a file this lane did not generate, or it lands inside
// the synthetic header. Both are drops, but they are now drops made in one place with a stated reason.
export function resolveAbidePosition<M extends GeneratedModule>(
    raw: RawDiagnostic,
    index: GeneratedIndex<M>,
): { module: M; line: number; column: number } | undefined {
    const module = index.get(raw.file.toLowerCase())
    if (module === undefined) return undefined
    if (raw.pos < CHECK_HEADER_LENGTH) return undefined
    const origin = mapGenToOrig(module.segments, raw.pos)
    return { module, ...offsetToLineColumn(module.source, origin) }
}

// Map a generated module's SPAN back to a `.abide` span. `undefined` means "not the author's code" —
// the same two drops `resolveAbidePosition` makes, plus an empty or inverted span.
//
// The exclusive END is the trap, and it is why this is a function rather than two calls to
// `mapGenToOrig`. That map's segments are half-open, so a generated end offset lands ON a boundary and
// is not inside the segment it terminates — it snaps forward to the NEXT segment's origin, which is
// somewhere else in the file entirely. So the last character is mapped INCLUSIVELY and one is added
// back. Hover carried that correction with a comment explaining it; `declToLocation` — which backs
// BOTH go-to-definition and find-references — mapped `decl.end` raw, so those two features could
// highlight a range that starts at the definition and ends at an unrelated later token.
export function resolveAbideRange(
    module: GeneratedModule,
    genStart: number,
    genEnd: number,
): { start: number; end: number } | undefined {
    if (genStart < CHECK_HEADER_LENGTH || genEnd <= genStart) return undefined
    const start = mapGenToOrig(module.segments, genStart)
    const end = mapGenToOrig(module.segments, genEnd - 1) + 1
    if (start < 0 || end <= start) return undefined
    return { start, end }
}

// A UTF-16 offset into `source` as 1-based line/column. Lives here rather than in `check.ts` (which is
// where the LSP used to import it from, making a CLI command double as the LSP's library) because it is
// part of this one step and has no other caller.
export function offsetToLineColumn(
    source: string,
    offset: number,
): { line: number; column: number } {
    let line = 1
    let column = 1
    const limit = Math.min(offset, source.length)
    for (let index = 0; index < limit; index++) {
        if (source.charCodeAt(index) === 10) {
            line++
            column = 1
        } else {
            column++
        }
    }
    return { line, column }
}
