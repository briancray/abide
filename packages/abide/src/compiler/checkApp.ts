import { relative } from 'node:path' // bun exposes no path helpers of its own
import { appFiles } from '#server/appTree.ts'
import { placeOf } from '#shared/routePattern.ts'
import {
    type AppChecker,
    emitApp,
    resolverIn,
    sourcesUnder,
    withChecker,
    withDependencies,
} from './compileApp.ts'
import { abideImportsOf } from './componentGraph.ts'
import {
    parseSources,
    type ReadSource,
    readSources,
    refusal,
} from './readSources.ts'
import type { Diagnosis } from './TypeSession.ts'
import { writeTypes } from './writeTypes.ts'

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
        const everyOwn = parseSources(sources, refused)
        await writeTypes(root, everyOwn, true, refused)
        // A file whose projection was refused is found already, and every later step projects it.
        const refusedPaths = new Set<string>()
        for (const found of refused) refusedPaths.add(found.path)
        const own: typeof everyOwn = []
        for (const source of everyOwn)
            if (!refusedPaths.has(source.path)) own.push(source)
        const resolve = resolverIn()
        const parsed = await withDependencies(root, own, resolve, refused)
        const { read, warnings } = await readSources(session, parsed, refused)
        // THE APP'S OWN FILES ARE REPORTED ON: a dependency's is compiled with them (34.27), and
        // what is wrong inside a package is the package's to report.
        const reported: ReadSource[] = []
        for (const source of read)
            if (placeOf(relative(root, source.path)) !== 'dependency')
                reported.push(source)
        const { diagnoses: found, refused: loweringRefused } =
            await session.diagnose(reported, root)
        const { ambient, unkeyed } = await session.lints(root, parsed)
        // A FILE WHOSE LOWERING REFUSED is `found` already, at its line — emitted too, it throws the
        // same refusal at the root and takes the rest of the app's findings with it.
        const emittable: ReadSource[] = []
        for (const source of read)
            if (!loweringRefused.has(source.path)) emittable.push(source)
        // 23.16-23.18 — what the build's walk would refuse of the tree, at each file it names.
        appFiles(root, (path, message) => {
            refused.push(refusal(`${root}/${path}`, message))
        })
        if (refused.length === 0 && ambient.length === 0)
            try {
                warnings.push(
                    ...(await emitApp(root, session, emittable, resolve))
                        .warnings,
                )
            } catch (thrown) {
                refused.push(refusal(root, thrown))
            }
        return [...refused, ...ambient, ...unkeyed, ...warnings, ...found]
    })
}

const FILES_CONFIG = /^\s*onConfig\s*\(/m

/**
 * The findings for one file as an editor holds it, saved or not.
 *
 * 38.11 — ONE FILE AS AN EDITOR HOLDS IT, saved or not: the same findings `checkApp` has for it, for
 * `abide lsp` to publish. The rest of the app is read from disk, as it stands — save a file `held`
 * has, which is one the editor holds too.
 *
 * 33.4 — THE COMPONENTS IT IMPORTS ARE LOWERED BESIDE IT, quietly, so a tag is held to the props its
 * component declares rather than to a stand-in that takes anything. One level: what a component
 * takes is its own declaration, and what its own imports take is its business.
 */
export async function checkSource(
    checker: AppChecker,
    path: string,
    text: string,
    held: (path: string) => string | undefined = () => undefined,
): Promise<Diagnosis[]> {
    const { session, root } = checker
    const refused: Diagnosis[] = []
    const [page] = parseSources([{ path, text }], refused)
    if (page === undefined) return refused
    const imports: { path: string; text: string; quiet: boolean }[] = []
    for (const imported of abideImportsOf(
        path,
        page.file,
        resolverIn(),
    ).values())
        try {
            imports.push({
                path: imported,
                text: held(imported) ?? (await Bun.file(imported).text()),
                quiet: true,
            })
        } catch {
            // A component that cannot be read takes anything here.
        }
    // 27.13 — AND EVERY FILE FILING `onConfig`, quietly, so a page that only reads `config()` is
    // typed by defaults it never imported — as `checkApp`'s whole-app program types it. The scan
    // only names candidates (a statement opening on the call); the checker decides which file.
    const lowered = new Set(imports.map((one) => one.path))
    const { sources } = await checker.sources()
    for (const other of sources) {
        if (other.path === path || lowered.has(other.path)) continue
        const text = held(other.path) ?? other.text
        if (FILES_CONFIG.test(text))
            imports.push({ path: other.path, text, quiet: true })
    }
    // A component that does not parse, or that the checker refuses, is its own file's finding and
    // takes anything here: a quiet source's refusal is reported by nobody.
    const { read, warnings } = await readSources(
        session,
        [page, ...parseSources(imports, refused)],
        refused,
    )
    if (refused.length > 0) return refused
    const own: Diagnosis[] = []
    for (const warning of warnings) if (warning.path === path) own.push(warning)
    const { diagnoses } = await session.diagnose(read, root, false)
    return [...own, ...diagnoses]
}
