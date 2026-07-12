import { AbideCompileError } from './AbideCompileError.ts'
import { parseTemplateRecovering } from './parseTemplateRecovering.ts'
import type { TemplateNode } from './types/TemplateNode.ts'

/*
The throwing facade over the error-recovering core (`parseTemplateRecovering`). The
compile path (SSR / client / type-check via `analyzeComponent` + `compileShadow`) is
FAIL-FAST: the first malformed construct must abort the build with a located error.
This delegates to the non-throwing core, then re-throws its FIRST diagnostic — the
first source-order failure — as an `AbideCompileError` carrying the same message and
offset the parser recorded, so the loader resolves it to `file:line:col`.

The core keeps every diagnostic (the LSP consumes them via `parseTemplateRecovering`
directly). Well-formed input yields zero diagnostics, so this returns `{ nodes }`
unchanged — no caller/type ripple, and the golden corpus stays byte-identical.
*/
export function parseTemplate(source: string, baseOffset = 0): { nodes: TemplateNode[] } {
    const { nodes, diagnostics } = parseTemplateRecovering(source, baseOffset)
    if (diagnostics.length > 0) {
        // biome-ignore lint/style/noNonNullAssertion: length > 0 guarantees diagnostics[0] is defined
        const first = diagnostics[0]!
        throw new AbideCompileError(first.message, first.start)
    }
    return { nodes }
}
