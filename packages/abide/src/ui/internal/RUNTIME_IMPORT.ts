// THE EMITTED RUNTIME IMPORT — the one line every emitted module opens with, and the one line three
// other modules rewrite.
//
// This is the `CONTEXT.md` "Owner" pattern reaching the seam it had not reached: the emitted TEXT. The
// emitters WRITE `import * as $rt from "abide/ui/internal/runtime"` as a string literal, and three
// separate places find it again by pattern match — `emit.ts` (pointing a temp module at a sibling
// runtime), `clientBundle.ts` (pointing it at an absolute path), and a test. Each spelled the search
// term itself, INCLUDING ITS DOUBLE QUOTES.
//
// So the producer and the three consumers agreed by coincidence. Changing the emitted quoting, spacing
// or namespace on the producing side does not break a build: `String.replace` simply finds nothing, the
// temp module keeps the bare package specifier, and it fails later as an unresolved import — or, where
// the rewrite was the thing pointing at a real file, does not fail at all and silently loads the wrong
// runtime. There is no error at the point the two disagree.
//
// `rewriteRuntimeImport` closes that by THROWING when the substitution finds nothing. A rewrite that
// cannot find what it was written to replace has had its premise invalidated; saying so is the whole
// difference between this and a `.replace()` call.

// Which machine the emitted module runs on (`CONTEXT.md`, "Substrate"): `serverRuntime` builds an HTML
// string, `runtime` mutates a live DOM node.
export type Substrate = 'client' | 'server'

// The namespace the emitters bind the runtime under. Every `$rt.<name>` in emitted code is keyed off
// this, so it is not a formatting choice.
export const RUNTIME_NAMESPACE = '$rt'

export const RUNTIME_SPECIFIER: Record<Substrate, string> = {
    client: 'abide/ui/internal/runtime',
    server: 'abide/ui/internal/serverRuntime',
}

// The statement an emitter writes. The ONLY place the emitted form is spelled.
export function runtimeImportStatement(substrate: Substrate): string {
    return `import * as ${RUNTIME_NAMESPACE} from ${JSON.stringify(RUNTIME_SPECIFIER[substrate])};\n`
}

// The exact text `rewriteRuntimeImport` searches for — derived from the same constant the emitter
// writes, rather than restated as a literal at each call site.
function runtimeSpecifierLiteral(substrate: Substrate): string {
    return JSON.stringify(RUNTIME_SPECIFIER[substrate])
}

// Point an emitted module's runtime import somewhere else — a sibling file, an absolute path — and FAIL
// LOUDLY if the import is not there to point.
//
// `to` is a specifier, not a literal: the quoting is this module's business on both ends, which is what
// stops a caller passing `'./runtime.ts'` where the other passes `'"./runtime.ts"'` (both were live).
export function rewriteRuntimeImport(source: string, substrate: Substrate, to: string): string {
    const from = runtimeSpecifierLiteral(substrate)
    if (!source.includes(from)) {
        throw new Error(
            `rewriteRuntimeImport: no ${from} import in the emitted ${substrate} module. The emitter's ` +
                `runtime import and this rewrite are out of step — see RUNTIME_IMPORT.ts.`,
        )
    }
    return source.replace(from, JSON.stringify(to))
}
