// The producer and the rewriters, asserted AGAINST EACH OTHER — which is the only assertion that means
// anything here. Checking that `runtimeImportStatement` returns a particular string would just be a
// second copy of the string; what matters is that whatever it emits is what `rewriteRuntimeImport`
// finds, on both substrates, through the real emitters.

import { describe, expect, test } from 'bun:test'
import { emitModuleSource } from './emit.ts'
import {
    RUNTIME_NAMESPACE,
    RUNTIME_SPECIFIER,
    rewriteRuntimeImport,
    runtimeImportStatement,
} from './RUNTIME_IMPORT.ts'

const SOURCE = '<script>let n = state(1)</script>\n<p>{n}</p>\n'

describe('the emitted runtime import', () => {
    for (const substrate of ['client', 'server'] as const) {
        test(`a real ${substrate} emit is rewritable`, () => {
            const emitted = emitModuleSource(SOURCE)
            const module = substrate === 'client' ? emitted.client : emitted.server
            // Through the REAL emitter, not through `runtimeImportStatement` — otherwise this proves
            // only that the constant matches itself, which is the failure mode `CONTEXT.md` records for
            // the first drift guard on the surface projections ("it only proved the LIST calls the
            // helper").
            const rewritten = rewriteRuntimeImport(module, substrate, './elsewhere.ts')
            expect(rewritten).toContain('"./elsewhere.ts"')
            expect(rewritten).not.toContain(RUNTIME_SPECIFIER[substrate])
        })

        test(`the ${substrate} emitter opens with the declared statement`, () => {
            const emitted = emitModuleSource(SOURCE)
            const module = substrate === 'client' ? emitted.client : emitted.server
            expect(module).toContain(runtimeImportStatement(substrate).trimEnd())
        })
    }

    test('emitted code binds the runtime under the declared namespace', () => {
        // `$rt.<name>` appears ~40 times in an emitted client module and ~18 in a server one; the
        // namespace is part of the ABI, not a formatting choice.
        const emitted = emitModuleSource(SOURCE)
        expect(emitted.client).toContain(`${RUNTIME_NAMESPACE}.`)
        expect(emitted.server).toContain(`${RUNTIME_NAMESPACE}.`)
    })

    test('a rewrite that finds nothing THROWS rather than silently passing the source through', () => {
        // The whole point. `String.replace` answers "no match" by returning the input unchanged, so the
        // temp module kept the bare package specifier and failed later — or, where the rewrite was what
        // pointed at a real file, did not fail at all and loaded the wrong runtime.
        expect(() => rewriteRuntimeImport('export const x = 1\n', 'client', './x.ts')).toThrow(
            /out of step/,
        )
    })
})
