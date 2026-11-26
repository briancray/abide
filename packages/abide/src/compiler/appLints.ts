import { ambientPathsIn, ambientReadsIn } from './ambientReadsIn.ts'
import { argsDefaultsIn } from './argsDefaultsIn.ts'
import {
    byPlace,
    type Diagnosis,
    type Finding,
    placedFindings,
} from './Diagnostics.ts'
import { discardedFailuresIn, failedAliasIn } from './discardedFailuresIn.ts'
import { projectShadow } from './projectShadow.ts'
import { abideIn } from './reactiveTypes.ts'
import type { ParsedSource } from './readSources.ts'
import type { ShadowHost } from './ShadowHost.ts'
import { ShadowMap } from './ShadowMap.ts'

/**
 * What the build refuses and warns on in the app's `.ts` files and its `.abide` `sources`.
 *
 * 11.37 — `ambient`: every read of a request's ambient inside a `global` value's body, as errors.
 * 11.30 — `unkeyed`: every `args` defaulting a member its body's parameter does not, as warnings.
 * 15.10 — and every statement whose value is a `Failed` nothing takes, among `ambient`'s errors.
 * Both over every `.ts` under `within` and each of `sources` as the shadow its reads registered
 * for it, because a keyed value is declared in a `.ts` as often as in a `.abide` — one walk of
 * the files for the two, each finding on its own line of the file an author wrote. `scripts`
 * as a diagnosis reads it: an editor asking about one page does not walk the app's `.ts`.
 */
export async function appLints(
    host: ShadowHost,
    within: string,
    sources: readonly Omit<ParsedSource, 'quiet'>[],
    scripts: boolean,
): Promise<{ ambient: Diagnosis[]; unkeyed: Diagnosis[] }> {
    const ambient: Diagnosis[] = []
    const unkeyed: Diagnosis[] = []
    await host.ask(async (project) => {
        const checker = project.checker
        const abide = await abideIn(project)
        const ambientPaths = await ambientPathsIn(project)
        const failed = await failedAliasIn(project)
        const authored = new Map<
            string,
            { source: (typeof sources)[number]; map: ShadowMap }
        >()
        for (const source of sources) {
            const map = new ShadowMap(
                host.canonical(source.path),
                projectShadow(source.file).origins,
            )
            authored.set(host.keyOf(map.shadowPath), { source, map })
        }
        // A file of the host's own is one of `sources`' shadows or not walked at all: a checked
        // module is the lowering's, and placed nowhere an author wrote.
        const files: string[] = []
        if (scripts)
            for (const path of host.rootsUnder(project, within)) {
                if (authored.has(host.keyOf(path)) || !host.holds(path))
                    files.push(path)
            }
        else for (const { map } of authored.values()) files.push(map.shadowPath)
        await Promise.all(
            files.map(async (path) => {
                const sourceFile = await project.program.getSourceFile(path)
                if (sourceFile === undefined) return
                const [reads, defaults, dropped] = await Promise.all([
                    ambientPaths.size === 0
                        ? []
                        : ambientReadsIn(checker, sourceFile, ambientPaths),
                    argsDefaultsIn(checker, sourceFile, abide.jsonSchema),
                    failed === undefined
                        ? []
                        : discardedFailuresIn(checker, sourceFile, failed),
                ])
                if (
                    reads.length === 0 &&
                    defaults.length === 0 &&
                    dropped.length === 0
                )
                    return
                const shadow = authored.get(host.keyOf(path))
                const source = shadow?.source
                const text =
                    source === undefined
                        ? await Bun.file(path).text()
                        : source.text
                const place = (at: number): number =>
                    shadow === undefined ? at : shadow.map.toSource(path, at)
                const named = source?.path ?? path
                const ambientReads: Finding[] = []
                for (const read of reads)
                    ambientReads.push({
                        at: read.at,
                        message: `abide: a \`global\` value's body reads \`${read.ambient}\`, which belongs to the request it was built in — every later request would be answered with this one's. Take it out of the body, or drop \`global\`. RULEBOOK 11.37.`,
                    })
                ambient.push(
                    ...placedFindings(
                        named,
                        text,
                        [...ambientReads, ...dropped],
                        place,
                        'error',
                    ),
                )
                unkeyed.push(
                    ...placedFindings(named, text, defaults, place, 'warning'),
                )
            }),
        )
    })
    ambient.sort(byPlace)
    unkeyed.sort(byPlace)
    return { ambient, unkeyed }
}
