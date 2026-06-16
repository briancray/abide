import { resolve } from 'node:path'
import ts from 'typescript'
import { compileShadow } from './compileShadow.ts'
import { loadShadowTsConfig } from './loadShadowTsConfig.ts'
import { resolveAbideImports } from './resolveAbideImports.ts'
import { shadowNaming } from './shadowNaming.ts'
import type { CompiledShadow } from './types/CompiledShadow.ts'

const { suffixed, isShadow, sourceOf } = shadowNaming

export type ShadowProgram = {
    program: ts.Program
    /* Compiled shadow (code + mappings) per `.abide` path, populated as the host
       materialises each source file; the diagnostic remapper reads the mappings. */
    shadows: Map<string, CompiledShadow>
    /* Files whose template failed to parse — surfaced as a diagnostic at offset 0. */
    parseErrors: Map<string, string>
    abidePaths: string[]
}

/*
Builds a `ts.Program` over the project's real `.ts` files plus a virtual shadow
`.ts` for every `.abide` component, behind a CompilerHost that serves shadow text
for any `*.abide.ts` name and resolves `.abide` imports to their shadows. Reuses
the project's tsconfig (lib/paths/baseUrl) so the shadows type-check against the
same world the app does; `noUnusedLocals`/`noUnusedParameters` are forced off
because the shadow legitimately declares scope bindings a template may not read.
*/
export function createShadowProgram(cwd: string): ShadowProgram {
    const { options, fileNames } = loadShadowTsConfig(cwd)
    const shadows = new Map<string, CompiledShadow>()
    const parseErrors = new Map<string, string>()
    const abidePaths = [...new Bun.Glob('**/*.abide').scanSync({ cwd, onlyFiles: true })]
        .filter((relative) => !relative.includes('node_modules'))
        .map((relative) => resolve(cwd, relative))

    /* Compiles (and caches) a `.abide` file's shadow; a template parse error yields
       a minimal valid module and a recorded message so the program still builds. */
    const shadowText = (abidePath: string): string => {
        const source = ts.sys.readFile(abidePath) ?? ''
        try {
            const compiled = compileShadow(source)
            shadows.set(abidePath, compiled)
            parseErrors.delete(abidePath)
            return compiled.code
        } catch (error) {
            shadows.set(abidePath, { code: '', mappings: [] })
            parseErrors.set(abidePath, error instanceof Error ? error.message : String(error))
            return 'export default function (): void {}\n'
        }
    }

    const host = ts.createCompilerHost(options, true)
    const originalGetSourceFile = host.getSourceFile.bind(host)
    host.getSourceFile = (fileName, languageVersionOrOptions, onError, shouldCreate) => {
        if (isShadow(fileName)) {
            return ts.createSourceFile(
                fileName,
                shadowText(sourceOf(fileName)),
                languageVersionOrOptions,
                true,
                ts.ScriptKind.TS,
            )
        }
        return originalGetSourceFile(fileName, languageVersionOrOptions, onError, shouldCreate)
    }
    host.fileExists = (fileName) =>
        isShadow(fileName) ? ts.sys.fileExists(sourceOf(fileName)) : ts.sys.fileExists(fileName)
    host.readFile = (fileName) =>
        isShadow(fileName) ? shadowText(sourceOf(fileName)) : ts.sys.readFile(fileName)
    host.resolveModuleNames = resolveAbideImports(options, host)

    const program = ts.createProgram({
        rootNames: [...fileNames, ...abidePaths.map((path) => suffixed(path))],
        options,
        host,
    })
    return { program, shadows, parseErrors, abidePaths }
}
