import { resolve } from 'node:path'
import ts from 'typescript'
import { messageFromError } from '../../shared/messageFromError.ts'
import { mapSyntacticClassification, mapTsClassification } from './ABIDE_SEMANTIC_TOKENS_LEGEND.ts'
import { assetModulesFile } from './assetModulesFile.ts'
import { compileShadow } from './compileShadow.ts'
import { isSpuriousAsyncReadDiagnostic } from './isSpuriousAsyncReadDiagnostic.ts'
import { loadShadowTsConfig } from './loadShadowTsConfig.ts'
import { pagePropsType } from './pagePropsType.ts'
import { remapShadowDiagnostic } from './remapShadowDiagnostic.ts'
import { resolveAbideImports } from './resolveAbideImports.ts'
import { shadowInterpolationClassifier } from './shadowInterpolationClassifier.ts'
import { shadowNaming } from './shadowNaming.ts'
import { sourceToShadowOffset } from './sourceToShadowOffset.ts'
import { templateStartOffset } from './templateStartOffset.ts'
import type { AbideDiagnostic } from './types/AbideDiagnostic.ts'
import type { CompiledShadow } from './types/CompiledShadow.ts'
import type { InterpolationClassifier } from './types/InterpolationClassifier.ts'
import type { SemanticToken } from './types/SemanticToken.ts'

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
    /* Type-aware semantic tokens for every checked expression, in source coords. */
    semanticClassifications: (abidePath: string) => SemanticToken[]
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
    /* Memo of `pagePropsType` (route re-parse) per source path; the path → props
       type mapping is immutable, so no version tag is needed. */
    const propsTypes = new Map<string, string | undefined>()

    /* The route props type for a component, parsed once and reused. */
    const propsTypeOf = (abidePath: string): string | undefined => {
        if (!propsTypes.has(abidePath)) {
            propsTypes.set(abidePath, pagePropsType(abidePath))
        }
        return propsTypes.get(abidePath)
    }

    /* Ambient declarations for bundler-handled asset imports (`*.css`, …). */
    const assets = assetModulesFile(cwd)

    const exists = (abidePath: string): boolean =>
        overlays.has(abidePath) || ts.sys.fileExists(abidePath)

    /* All component shadows: those on disk plus any opened (possibly unsaved) ones. */
    const shadowNames = (): string[] => {
        const disk = [...new Bun.Glob('**/*.abide').scanSync({ cwd, onlyFiles: true })]
            .filter((relative) => !relative.includes('node_modules'))
            .map((relative) => resolve(cwd, relative))
        return [...new Set([...disk, ...overlays.keys()])].map(suffixed)
    }

    /* One incremental language service over the shadow world, its shadows built by `compile`. Two
       are made: a VERBATIM one (the classifier source — interpolations un-wrapped, so `getFoo()`
       still types as `Promise`), and the WRAPPED main one (async interpolations peek-wrapped, ADR-
       0032, so hover/completions/diagnostics see the RESOLVED value). They share `overlays`/`versions`
       so both reflect unsaved edits, but hold SEPARATE shadow caches + document registries (the same
       shadow file name carries different text in each). */
    const buildService = (compile: (source: string, abidePath: string) => CompiledShadow) => {
        const shadows = new Map<string, CompiledShadow>()
        const parseErrors = new Map<string, string>()
        /* Memo of `shadowText` output keyed by source path, tagged with the shadow version it was
           compiled at; a stale tag forces recompilation. `update`/`close` bump that version. */
        const compiledAt = new Map<string, { version: number; code: string }>()
        const shadowText = (abidePath: string): string => {
            const version = versions.get(suffixed(abidePath)) ?? 0
            const memo = compiledAt.get(abidePath)
            if (memo !== undefined && memo.version === version) {
                return memo.code
            }
            const source = overlays.get(abidePath) ?? ts.sys.readFile(abidePath) ?? ''
            try {
                const compiled = compile(source, abidePath)
                shadows.set(abidePath, compiled)
                parseErrors.delete(abidePath)
                compiledAt.set(abidePath, { version, code: compiled.code })
                return compiled.code
            } catch (error) {
                shadows.set(abidePath, { code: '', mappings: [] })
                parseErrors.set(abidePath, messageFromError(error))
                const code = 'export default function (): void {}\n'
                compiledAt.set(abidePath, { version, code })
                return code
            }
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
        return {
            service: ts.createLanguageService(host, ts.createDocumentRegistry()),
            shadows,
            parseErrors,
            shadowText,
        }
    }

    const verbatim = buildService((source, abidePath) =>
        compileShadow(source, propsTypeOf(abidePath)),
    )
    /* The wrapped shadow's peek-wrap is type-directed: it asks the verbatim program which
       sub-expressions are async. `getProgram()` reflects the shared overlays/versions, so the
       classifier tracks unsaved edits; fail-open to `undefined` (verbatim shadow) if unavailable. */
    const classifierFor = (abidePath: string): InterpolationClassifier | undefined => {
        const program = verbatim.service.getProgram()
        return program === undefined
            ? undefined
            : shadowInterpolationClassifier(program, verbatim.shadows, abidePath)
    }
    const main = buildService((source, abidePath) =>
        compileShadow(source, propsTypeOf(abidePath), classifierFor(abidePath)),
    )
    const { service, shadows, parseErrors, shadowText } = main

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
            /* The shadow file + checker + template boundary, for the ADR-0032 bare-async-read
               suppression (mirrors `collectAbideDiagnostics` so the editor and CLI agree). */
            const shadowFile = service.getProgram()?.getSourceFile(fileName)
            const checker = service.getProgram()?.getTypeChecker()
            const source = overlays.get(abidePath) ?? ts.sys.readFile(abidePath) ?? ''
            const templateStart = templateStartOffset(source)
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
                /* Drop the spurious "property missing on Promise" / "condition always defined" a
                   bare async read provokes — the runtime peeks the resolved value (ADR-0032). */
                if (
                    shadowFile !== undefined &&
                    checker !== undefined &&
                    located.start >= templateStart &&
                    isSpuriousAsyncReadDiagnostic(
                        shadowFile,
                        checker,
                        diagnostic.code,
                        diagnostic.start,
                        diagnostic.length ?? 0,
                    )
                ) {
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
        semanticClassifications(abidePath) {
            const fileName = suffixed(abidePath)
            /* Compile first so the mappings cache is current. */
            shadowText(abidePath)
            const shadow = shadows.get(abidePath)
            if (shadow === undefined) {
                return []
            }
            const { spans } = service.getEncodedSemanticClassifications(
                fileName,
                { start: 0, length: shadow.code.length },
                ts.SemanticClassificationFormat.TwentyTwenty,
            )
            /* `spans` is flat triples [start, length, classification, …] in shadow
               coords; keep only those overlapping a mapped expression segment. */
            const tokens: SemanticToken[] = []
            for (let index = 0; index + 2 < spans.length; index += 3) {
                const spanStart = spans[index]
                const spanLength = spans[index + 1]
                const classification = spans[index + 2]
                if (
                    spanStart === undefined ||
                    spanLength === undefined ||
                    classification === undefined
                ) {
                    continue
                }
                const mapped = mapTsClassification(classification)
                if (mapped === undefined) {
                    continue
                }
                const located = remapShadowDiagnostic(shadow.mappings, spanStart, spanLength)
                if (located === undefined) {
                    continue
                }
                tokens.push({
                    start: located.start,
                    length: located.length,
                    type: mapped.type,
                    modifiers: mapped.modifiers,
                })
            }
            /* Literal syntactic tokens (string/number/regex) the semantic classifier
               never emits — so a template-literal string inside `{…}` gets colored. */
            const syntactic = service.getEncodedSyntacticClassifications(fileName, {
                start: 0,
                length: shadow.code.length,
            })
            for (let index = 0; index + 2 < syntactic.spans.length; index += 3) {
                const spanStart = syntactic.spans[index]
                const spanLength = syntactic.spans[index + 1]
                const classification = syntactic.spans[index + 2]
                if (
                    spanStart === undefined ||
                    spanLength === undefined ||
                    classification === undefined
                ) {
                    continue
                }
                const type = mapSyntacticClassification(classification)
                if (type === undefined) {
                    continue
                }
                const located = remapShadowDiagnostic(shadow.mappings, spanStart, spanLength)
                if (located === undefined) {
                    continue
                }
                tokens.push({ start: located.start, length: located.length, type, modifiers: [] })
            }
            return tokens
        },
    }
}
