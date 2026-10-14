import { relative } from 'node:path' // bun exposes no path helpers of its own
import { type Placement, placement } from '#server/placement.ts'
import { type AppChecker, compiled } from './compileApp.ts'
import { abideImportsOf } from './componentGraph.ts'
import { hooksIn } from './hookCalls.ts'
import { parseAbide, scriptBodies } from './parseAbide.ts'
import { Refusals } from './Refusals.ts'
import { parseSources, readSources } from './readSources.ts'
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
 * of every file that got that far (`compiled`).
 */
export async function checkApp(
    appRoot: string,
    kept?: AppChecker,
): Promise<Diagnosis[]> {
    return (await compiled(appRoot, kept, true)).findings
}

/**
 * The findings for one file as an editor holds it, saved or not.
 *
 * 38.11 — ONE FILE AS AN EDITOR HOLDS IT, saved or not: the same findings `checkApp` has for it, for
 * `abide lsp` to publish. The rest of the app is read from disk, as it stands — save a file `held`
 * has, which is one the editor holds too — and so is what the tree refuses of this one (38.34).
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
    const layout = await checker.layout()
    // 38.33 — WHAT THE TREE REFUSES OF IT, off the layout the checker keeps until a move is heard.
    const tree: Diagnosis[] = []
    for (const refused of layout.refused)
        if (refused.path === path) tree.push(refused)
    const refusals = new Refusals(root, true)
    const [page] = parseSources([{ path, text }], refusals)
    if (page === undefined) return [...tree, ...refusals.found]
    // 23.19 — WHERE THE APP PLACES IT, so a mounted page's `route.params` is typed by the route its
    // mount gives it, as `checkApp` types it; a file the layout has not seen is placed at its path.
    const placed: Pick<Placement, 'kind' | 'route'> =
        layout.sources.find((source) => source.path === path) ??
        placement(relative(root, path))
    const imports: { path: string; text: string; quiet: boolean }[] = []
    for (const imported of abideImportsOf(
        path,
        page.file,
        layout.resolve,
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
    // typed by defaults it never imported — as `checkApp`'s whole-app program types it. The calls
    // only name candidates; the checker decides which file.
    const lowered = new Set(imports.map((one) => one.path))
    for (const other of layout.sources) {
        if (other.path === path || lowered.has(other.path)) continue
        const editing = held(other.path)
        if (
            editing === undefined || editing === other.text
                ? other.hooks.includes('onConfig')
                : filesConfig(editing)
        )
            imports.push({
                path: other.path,
                text: editing ?? other.text,
                quiet: true,
            })
    }
    // A component that does not parse, or that the checker refuses, is its own file's finding and
    // takes anything here: a quiet source's refusal is reported by nobody.
    const { read, warnings } = await readSources(
        session,
        [page, ...parseSources(imports, refusals)],
        refusals,
    )
    if (refusals.found.length > 0) return [...tree, ...refusals.found]
    const own: Diagnosis[] = []
    for (const warning of warnings) if (warning.path === path) own.push(warning)
    const [checked, ...beside] = read
    const { diagnoses } = await session.diagnose(
        checked === undefined
            ? beside
            : [
                  { ...checked, kind: placed.kind, route: placed.route },
                  ...beside,
              ],
        layout,
        false,
    )
    return [...tree, ...own, ...diagnoses]
}

/** Whether a `.abide` an editor holds calls `onConfig`, where its text parses. */
function filesConfig(text: string): boolean {
    try {
        return hooksIn(scriptBodies(parseAbide(text))).includes('onConfig')
    } catch {
        return false
    }
}
