// The producer and the rewriters, asserted AGAINST EACH OTHER — which is the only assertion that means
// anything here. Checking that `runtimeImportStatement` returns a particular string would just be a
// second copy of the string; what matters is that whatever it emits is what `rewriteRuntimeImport`
// finds, on both substrates, through the real emitters.

import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rewriteImportSpecifier } from './analyzeBindings.ts'
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

describe('a side-effect import survives the emit', () => {
    // `import "./polyfill.ts"` used to be DELETED from both substrates with no diagnostic: `parseImport`
    // required a `from`, so it produced no binding, while the scanner still recorded the statement and
    // the classifier stripped its range unconditionally. It sat next to imports that survived.
    //
    // These pass a real `dir`, because that is how production calls `emitModuleSource` and it is the
    // only way the assertion means anything: WITHOUT one, `passesThrough` admits only `abide/shared/*`
    // and `abide/ui/*` — so a dir-less fixture reports an empty `moduleImports` for every ordinary
    // specifier whether this works or not. A first version of this test was written that way and read
    // as a failure of the fix rather than of the fixture.
    function project(files: Record<string, string>): string {
        const dir = mkdtempSync(join(tmpdir(), 'abide-bare-import-'))
        for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body)
        return dir
    }

    test('a bare relative import is re-emitted on BOTH substrates', () => {
        const dir = project({ 'polyfill.ts': 'globalThis.x = 1\n' })
        const emitted = emitModuleSource(
            '<script>\nimport "./polyfill.ts"\n</script>\n<p>hi</p>\n',
            dir,
        )
        expect(emitted.analysis.moduleImports.map((m) => m.specifier)).toEqual(['./polyfill.ts'])
        expect(emitted.client).toContain('import "./polyfill.ts"')
        expect(emitted.server).toContain('import "./polyfill.ts"')
    })

    test('it sits alongside a clause-carrying import from the same script', () => {
        const dir = project({
            'polyfill.ts': 'globalThis.x = 1\n',
            'util.ts': 'export const helper = 1\n',
        })
        const emitted = emitModuleSource(
            '<script>\nimport "./polyfill.ts"\nimport { helper } from "./util.ts"\n</script>\n<p>{helper}</p>\n',
            dir,
        )
        expect(emitted.analysis.moduleImports.map((m) => m.specifier)).toEqual([
            './polyfill.ts',
            './util.ts',
        ])
    })

    test('a bare CSS import still belongs to the CSS owner, not to module imports', () => {
        // The two clause-less forms are different facts. `cssSideEffectSpecifier` already owned this
        // one, and the classifier reads `cssSpecifier` only when there is NO binding — so claiming it
        // in `parseImport` takes every stylesheet out of `cssImports` and the page renders with no
        // `<link>`. That is what happened on the first attempt, and it is why the guard is there.
        const dir = project({ 'styles.css': 'p { color: red }\n' })
        const emitted = emitModuleSource(
            '<script>\nimport "./styles.css"\n</script>\n<p>hi</p>\n',
            dir,
        )
        expect(emitted.analysis.cssImports).toEqual(['./styles.css'])
        expect(emitted.analysis.moduleImports).toEqual([])
    })

    test('rewriting a clause-less import finds it — `from "spec"` never could', () => {
        const dir = project({ 'polyfill.ts': 'globalThis.x = 1\n' })
        const emitted = emitModuleSource(
            '<script>\nimport "./polyfill.ts"\n</script>\n<p>hi</p>\n',
            dir,
        )
        const rewritten = rewriteImportSpecifier(
            emitted.client,
            './polyfill.ts',
            '/abs/polyfill.js',
        )
        expect(rewritten).toContain('import "/abs/polyfill.js"')
        expect(rewritten).not.toContain('"./polyfill.ts"')
    })
})
