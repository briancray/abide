import { realpathSync } from 'node:fs' // bun exposes no realpath of its own
import { dirname } from 'node:path' // bun exposes no path helpers of its own
import type { Read } from './classifyRead.ts'
import {
    type AppChecker,
    emitApp,
    resolveFrom,
    sourcesUnder,
    withChecker,
} from './compileApp.ts'
import { withInline } from './inlineSources.ts'
import { diagnosisAt } from './lineOf.ts'
import { type AbideFile, parseAbide } from './parseAbide.ts'
import { abideSpecifiers } from './splitImports.ts'
import type { Diagnosis } from './TypeSession.ts'

/**
 * Every finding `abide check` reports for the app at `appRoot`.
 *
 * 38.3 — `abide check`: every `.abide` under the app checked as the program it runs as, and every
 * `.ts` beside them as it stands, each diagnosis on the line the author wrote — with the
 * compiler's own warnings, and what the build would refuse.
 *
 * A REFUSAL IS A FINDING, NOT THE END OF THE RUN. The build stops at the first thing it refuses,
 * which is right for a build and wrong for a check: a file the parser or the read classifier
 * refuses is reported at its first line, and the rest of the app is checked around it. A refusal
 * only the whole app can see — two handlers at one address — comes from emitting it over the reads
 * already taken, which is asked only once every file has got that far on its own.
 */
export async function checkApp(
    appRoot: string,
    kept?: AppChecker,
): Promise<Diagnosis[]> {
    const { root, sources } = await sourcesUnder(appRoot)
    return withChecker(root, kept, async (session) => {
        const refused: Diagnosis[] = []
        const read: { path: string; text: string; file: AbideFile }[] = []
        for (const source of sources)
            try {
                read.push({ ...source, file: parseAbide(source.text) })
            } catch (thrown) {
                refused.push(refusal(source.path, thrown))
            }
        const parsed = withInline(read)
        // ONE SNAPSHOT FOR THE LOT, and a file at a time only once that has refused — so which
        // file it was is known, and the others still answer.
        let reads: Read[][]
        let warnings: Diagnosis[]
        let readable = parsed
        try {
            ;({ reads, warnings } = await session.readsFor(parsed))
        } catch {
            reads = []
            warnings = []
            readable = []
            for (const source of parsed)
                try {
                    const answered = await session.readsFor([source])
                    reads.push(...answered.reads)
                    warnings.push(...answered.warnings)
                    readable.push(source)
                } catch (thrown) {
                    refused.push(
                        refusal(source.inlineOf?.path ?? source.path, thrown),
                    )
                }
        }
        const typed = readable.map((source, at) => ({
            ...source,
            reads: reads[at] ?? [],
        }))
        const found = await session.diagnose(typed, root)
        const ambient = await session.ambientReads(root)
        const unkeyed = await session.argsDefaults(root)
        // A FILE WHOSE LOWERING REFUSED is `found` already, at its line — emitted too, it throws the
        // same refusal at the root and takes the rest of the app's findings with it.
        const emittable: typeof readable = []
        const emittableReads: Read[][] = []
        for (let at = 0; at < readable.length; at += 1) {
            const source = readable[at] as (typeof readable)[number]
            if (session.lowerRefused(source.path)) continue
            emittable.push(source)
            emittableReads.push(reads[at] ?? [])
        }
        if (refused.length === 0 && ambient.length === 0)
            try {
                warnings.push(
                    ...(await emitApp(root, session, emittable, emittableReads))
                        .warnings,
                )
            } catch (thrown) {
                refused.push(refusal(root, thrown))
            }
        return [...refused, ...ambient, ...unkeyed, ...warnings, ...found]
    })
}

function refusal(path: string, thrown: unknown): Diagnosis {
    return diagnosisAt(
        path,
        undefined,
        0,
        'error',
        thrown instanceof Error ? thrown.message : String(thrown),
    )
}

/**
 * The findings for one file as an editor holds it, saved or not.
 *
 * 38.12 — ONE FILE AS AN EDITOR HOLDS IT, saved or not: the same findings `checkApp` has for it, for
 * `abide lsp` to publish. The rest of the app is read from disk, as it stands — save a file `held`
 * has, which is one the editor holds too.
 *
 * 33.4 — THE COMPONENTS IT IMPORTS ARE LOWERED BESIDE IT, quietly, so a tag is held to the props its
 * component declares rather than to a stand-in that takes anything. One level: what a component
 * takes is its own declaration, and what its own imports take is its business.
 */
export async function checkSource(
    checker: AppChecker,
    root: string,
    path: string,
    text: string,
    held: (path: string) => string | undefined = () => undefined,
): Promise<Diagnosis[]> {
    const session = checker.session
    let file: AbideFile
    try {
        file = parseAbide(text)
    } catch (thrown) {
        return [refusal(path, thrown)]
    }
    const sources: {
        path: string
        text: string
        file: AbideFile
        quiet?: boolean
    }[] = [{ path, text, file }]
    const from = dirname(path)
    // THE RESOLVER FOLLOWS SYMLINKS AND THE PAGE'S PATH DOES NOT: under a linked root — `/tmp` is one
    // on macOS — a component resolves outside the page's own spelling of the app, where neither the
    // shadow the page's import is pointed at nor the editor's unsaved text is found.
    const linkedRoot = realpathSync(root)
    for (const specifier of abideSpecifiers(
        [...file.modules, ...file.scripts].join('\n'),
    )) {
        let imported = resolveFrom(specifier, from)
        if (imported === undefined) continue
        if (linkedRoot !== root && imported.startsWith(`${linkedRoot}/`))
            imported = `${root}${imported.slice(linkedRoot.length)}`
        try {
            const importedText =
                held(imported) ?? (await Bun.file(imported).text())
            sources.push({
                path: imported,
                text: importedText,
                file: parseAbide(importedText),
                quiet: true,
            })
        } catch {
            // A component that does not parse is its own file's finding, and takes anything here.
        }
    }
    // 32.39 — the page's inline components stand right after it, and are reported on as it is.
    const expanded = withInline(sources)
    let answered: Awaited<ReturnType<typeof session.readsFor>>
    try {
        answered = await session.readsFor(expanded)
    } catch {
        // The page's own refusal, or a component's: asked alone, the page says which.
        expanded.length = 1 + file.components.length
        try {
            answered = await session.readsFor(expanded)
        } catch (alone) {
            return [refusal(path, alone)]
        }
    }
    const warnings: Diagnosis[] = []
    for (const warning of answered.warnings)
        if (warning.path === path) warnings.push(warning)
    const found = await session.diagnose(
        expanded.map((source, at) => ({
            ...source,
            reads: answered.reads[at] ?? [],
        })),
        root,
        false,
    )
    return [...warnings, ...found]
}
