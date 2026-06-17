import { resolve } from 'node:path'
import ts from 'typescript'
import { assetModulesFile } from './assetModulesFile.ts'
import { compileShadow } from './compileShadow.ts'
import { loadShadowTsConfig } from './loadShadowTsConfig.ts'
import { remapShadowDiagnostic } from './remapShadowDiagnostic.ts'
import { resolveAbideImports } from './resolveAbideImports.ts'
import { shadowNaming } from './shadowNaming.ts'
import { sourceToShadowOffset } from './sourceToShadowOffset.ts'
import type { AbideDiagnostic } from './types/AbideDiagnostic.ts'
import type { CompiledShadow } from './types/CompiledShadow.ts'

const { suffixed, isShadow, sourceOf } = shadowNaming

/* Hover quick-info for a source position: TypeScript's signature line and doc
   comment, with the covered span mapped back onto the `.abide` source. */
export type ShadowQuickInfo = { text: string; documentation: string; start: number; length: number }

export type ShadowLanguageService = {
    /* Record/replace an open document's in-memory text (overrides disk). */
    update: (abidePath: string, text: string) => void
    /* Forget an open document; subsequent reads fall back to disk. */
    close: (abidePath: string) => void
    /* Current diagnostics for one component, mapped onto its source. */
    diagnostics: (abidePath: string) => AbideDiagnostic[]
    /* Hover info at a source offset, or undefined if the offset isn't a checked
       expression (markup, whitespace) or TypeScript has nothing to report. */
    quickInfo: (abidePath: string, sourceOffset: number) => ShadowQuickInfo | undefined
}

/*
An incremental `ts.LanguageService` over the shadow world, for the LSP. Open
documents are held as in-memory overlays that override disk, so diagnostics
reflect unsaved edits; every other file (real `.ts`, unopened `.abide`) reads from
disk. Shares the shadow compiler, module resolver, and tsconfig with the one-shot
check Program — the editor and CLI report identically.
*/
export function createShadowLanguageService(cwd: string): ShadowLanguageService {
    const { options, fileNames } = loadShadowTsConfig(cwd)
    const overlays = new Map<string, string>()
    const versions = new Map<string, number>()
    const shadows = new Map<string, CompiledShadow>()
    const parseErrors = new Map<string, string>()

    /* Ambient declarations for bundler-handled asset imports (`*.css`, …). */
    const assets = assetModulesFile(cwd)

    const exists = (abidePath: string): boolean =>
        overlays.has(abidePath) || ts.sys.fileExists(abidePath)

    /* Compiles (and caches) a component's shadow from its overlay or disk text; a
       template parse error yields a minimal valid module + a recorded message. */
    const shadowText = (abidePath: string): string => {
        const source = overlays.get(abidePath) ?? ts.sys.readFile(abidePath) ?? ''
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

    /* All component shadows: those on disk plus any opened (possibly unsaved) ones. */
    const shadowNames = (): string[] => {
        const disk = [...new Bun.Glob('**/*.abide').scanSync({ cwd, onlyFiles: true })]
            .filter((relative) => !relative.includes('node_modules'))
            .map((relative) => resolve(cwd, relative))
        return [...new Set([...disk, ...overlays.keys()])].map(suffixed)
    }

    const moduleResolutionHost: ts.ModuleResolutionHost = {
        fileExists: (fileName) =>
            fileName === assets.path ||
            (isShadow(fileName) ? exists(sourceOf(fileName)) : ts.sys.fileExists(fileName)),
        readFile: (fileName) =>
            fileName === assets.path
                ? assets.content
                : isShadow(fileName)
                  ? shadowText(sourceOf(fileName))
                  : ts.sys.readFile(fileName),
    }

    const host: ts.LanguageServiceHost = {
        getScriptFileNames: () => [assets.path, ...fileNames, ...shadowNames()],
        getScriptVersion: (fileName) => String(versions.get(fileName) ?? 0),
        getScriptSnapshot: (fileName) => {
            if (fileName === assets.path) {
                return ts.ScriptSnapshot.fromString(assets.content)
            }
            if (isShadow(fileName)) {
                return exists(sourceOf(fileName))
                    ? ts.ScriptSnapshot.fromString(shadowText(sourceOf(fileName)))
                    : undefined
            }
            const text = ts.sys.readFile(fileName)
            return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text)
        },
        getCurrentDirectory: () => cwd,
        getCompilationSettings: () => options,
        getDefaultLibFileName: (compilerOptions) => ts.getDefaultLibFilePath(compilerOptions),
        fileExists: moduleResolutionHost.fileExists,
        readFile: moduleResolutionHost.readFile,
        readDirectory: ts.sys.readDirectory,
        directoryExists: ts.sys.directoryExists,
        getDirectories: ts.sys.getDirectories,
        resolveModuleNames: resolveAbideImports(options, moduleResolutionHost),
    }
    const service = ts.createLanguageService(host, ts.createDocumentRegistry())

    const bump = (abidePath: string): void => {
        const fileName = suffixed(abidePath)
        versions.set(fileName, (versions.get(fileName) ?? 0) + 1)
    }

    return {
        update(abidePath, text) {
            overlays.set(abidePath, text)
            bump(abidePath)
        },
        close(abidePath) {
            overlays.delete(abidePath)
            bump(abidePath)
        },
        diagnostics(abidePath) {
            const fileName = suffixed(abidePath)
            /* Fetching diagnostics drives getScriptSnapshot → shadowText, so the
               shadows/parseErrors caches are current before we read them. */
            const raw = [
                ...service.getSyntacticDiagnostics(fileName),
                ...service.getSemanticDiagnostics(fileName),
            ]
            const parseError = parseErrors.get(abidePath)
            if (parseError !== undefined) {
                return [
                    {
                        file: abidePath,
                        start: 0,
                        length: 0,
                        message: parseError,
                        category: ts.DiagnosticCategory.Error,
                    },
                ]
            }
            const mappings = shadows.get(abidePath)?.mappings ?? []
            return raw.flatMap((diagnostic) => {
                if (diagnostic.start === undefined) {
                    return []
                }
                const located = remapShadowDiagnostic(
                    mappings,
                    diagnostic.start,
                    diagnostic.length ?? 0,
                )
                if (located === undefined) {
                    return []
                }
                return [
                    {
                        file: abidePath,
                        start: located.start,
                        length: located.length,
                        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
                        category: diagnostic.category,
                    },
                ]
            })
        },
        quickInfo(abidePath, sourceOffset) {
            const fileName = suffixed(abidePath)
            /* Compile the shadow first so its mappings are current before we
               translate the source offset into shadow coordinates. */
            shadowText(abidePath)
            const mappings = shadows.get(abidePath)?.mappings ?? []
            const shadowOffset = sourceToShadowOffset(mappings, sourceOffset)
            if (shadowOffset === undefined) {
                return undefined
            }
            const info = service.getQuickInfoAtPosition(fileName, shadowOffset)
            if (info === undefined) {
                return undefined
            }
            /* The reported span is in shadow coordinates; map it back so the editor
               highlights the matching source. Falls back to the hovered offset. */
            const span = remapShadowDiagnostic(mappings, info.textSpan.start, info.textSpan.length)
            return {
                text: ts.displayPartsToString(info.displayParts),
                documentation: ts.displayPartsToString(info.documentation),
                start: span?.start ?? sourceOffset,
                length: span?.length ?? 1,
            }
        },
    }
}
