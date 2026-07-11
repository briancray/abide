import { resolve } from 'node:path'
import ts from 'typescript'
import { messageFromError } from '../../shared/messageFromError.ts'
import { assetModulesFile } from './assetModulesFile.ts'
import { cachedSourceFile } from './cachedSourceFile.ts'
import { compileShadow } from './compileShadow.ts'
import { loadShadowTsConfig } from './loadShadowTsConfig.ts'
import { pagePropsType } from './pagePropsType.ts'
import { resolveAbideImports } from './resolveAbideImports.ts'
import { shadowNaming } from './shadowNaming.ts'
import { sourceFileOptionsSignature } from './sourceFileOptionsSignature.ts'
import type { CompiledShadow } from './types/CompiledShadow.ts'
import type { InterpolationClassifier } from './types/InterpolationClassifier.ts'

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
export function createShadowProgram(
    cwd: string,
    abidePaths?: string[],
    /* Per-file interpolation classifier (ADR-0032). When provided, each shadow peek-wraps its async
       sub-expressions so they type-check against the RESOLVED value; it must be backed by a SEPARATE
       verbatim program (see `checkAbide`), since a classifier reading these same wrapped shadows
       would be circular. Absent ⇒ verbatim shadows (the classifier-source pass, and any caller that
       doesn't need the peek types). */
    classifierFor?: (abidePath: string) => InterpolationClassifier | undefined,
): ShadowProgram {
    const { options, fileNames } = loadShadowTsConfig(cwd)
    const shadows = new Map<string, CompiledShadow>()
    const parseErrors = new Map<string, string>()
    /* The components to root the program at — caller-supplied (one project's files)
       or, by default, every `.abide` under `cwd`. Imported components resolve on
       demand through the host, so an explicit subset still type-checks fully. */
    const rootAbidePaths =
        abidePaths ??
        [...new Bun.Glob('**/*.abide').scanSync({ cwd, onlyFiles: true })]
            .filter((relative) => !relative.includes('node_modules'))
            .map((relative) => resolve(cwd, relative))

    /* Compiles (and caches) a `.abide` file's shadow; a template parse error yields
       a minimal valid module and a recorded message so the program still builds. */
    const shadowText = (abidePath: string): string => {
        const source = ts.sys.readFile(abidePath) ?? ''
        try {
            const compiled = compileShadow(
                source,
                pagePropsType(abidePath),
                classifierFor?.(abidePath),
            )
            shadows.set(abidePath, compiled)
            parseErrors.delete(abidePath)
            return compiled.code
        } catch (error) {
            shadows.set(abidePath, { code: '', mappings: [] })
            parseErrors.set(abidePath, messageFromError(error))
            return 'export default function (): void {}\n'
        }
    }

    /* Ambient declarations for bundler-handled asset imports (`*.css`, …). */
    const assets = assetModulesFile(cwd)

    /* The parse/bind-affecting options are identical for every source in a program, so compute
       the cache signature once and reuse it for every file (see `cachedSourceFile`). */
    const signature = sourceFileOptionsSignature(options)

    const host = ts.createCompilerHost(options, true)
    const originalGetSourceFile = host.getSourceFile.bind(host)
    host.getSourceFile = (fileName, languageVersionOrOptions, onError, shouldCreate) => {
        if (fileName === assets.path) {
            return cachedSourceFile(fileName, assets.content, languageVersionOrOptions, signature)
        }
        if (isShadow(fileName)) {
            /* `shadowText` populates the per-program `shadows`/`parseErrors` maps as a side effect,
               so it must run on every call — only its expensive TS parse is memoised by `cachedSourceFile`. */
            return cachedSourceFile(
                fileName,
                shadowText(sourceOf(fileName)),
                languageVersionOrOptions,
                signature,
                ts.ScriptKind.TS,
            )
        }
        /* Real `.ts`/`.d.ts` inputs (the ~3MB of default libs plus resolved dependencies) — read the
           text and reuse the parsed file across programs when it is byte-identical. Fall back to the
           default host on a read failure so its missing-file / `onError` handling is preserved. */
        const text = ts.sys.readFile(fileName)
        if (text === undefined) {
            return originalGetSourceFile(fileName, languageVersionOrOptions, onError, shouldCreate)
        }
        return cachedSourceFile(fileName, text, languageVersionOrOptions, signature)
    }
    host.fileExists = (fileName) =>
        fileName === assets.path ||
        (isShadow(fileName) ? ts.sys.fileExists(sourceOf(fileName)) : ts.sys.fileExists(fileName))
    host.readFile = (fileName) => {
        if (fileName === assets.path) {
            return assets.content
        }
        return isShadow(fileName) ? shadowText(sourceOf(fileName)) : ts.sys.readFile(fileName)
    }
    host.resolveModuleNames = resolveAbideImports(options, host)

    const program = ts.createProgram({
        rootNames: [assets.path, ...fileNames, ...rootAbidePaths.map((path) => suffixed(path))],
        options,
        host,
    })
    return { program, shadows, parseErrors, abidePaths: rootAbidePaths }
}
