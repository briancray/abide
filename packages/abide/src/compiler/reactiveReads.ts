import { getTouchingPropertyName } from 'typescript/unstable/ast'
import type { Project } from 'typescript/unstable/async'

import { checkedShadow } from './checkedShadow.ts'
import { type CheckerAnswer, UNCHECKED } from './CheckerAnswer.ts'
import { byPlace, type Diagnosis, placedFindings } from './Diagnostics.ts'
import { type Projection, projectShadow } from './projectShadow.ts'
import { type Abide, abideIn, isReactiveSymbol } from './reactiveTypes.ts'
import { readsIn } from './readsIn.ts'
import type { ParsedSource } from './readSources.ts'
import type { ShadowEdit, ShadowHost } from './ShadowHost.ts'
import { mapForward, ShadowMap } from './ShadowMap.ts'
import { templateWarnings } from './templateWarnings.ts'

/** Whether a script can bind a name at all — a file that cannot is never handed to the checker. */
const DECLARES = /\b(?:const|let|var|import)\b/

/**
 * Reads and compiler warnings for every file, in one checker snapshot.
 *
 * 31.3 — THE READS IN EACH FILE: every occurrence of a name bound to a `Reactive`, classified, in
 * its projection (`projectShadow`). Everything else is left exactly as written. What each file's
 * shadow is asked is `readsIn`'s; the rounds a binding typed from a read takes are this module's.
 *
 * EVERY FILE IN ONE SNAPSHOT, which is the whole of the compiler's build time. Measured at
 * 19.7 ms a file taking a snapshot each against 0.8 ms a file sharing one — 25x, because
 * adding a file to the project's root set is what costs, not asking about it.
 *
 * WHAT IT HAS TO SAY THAT IS NOT A TYPE ERROR comes back beside the reads: the compiler's own
 * warnings (14.14 to 14.17, 32.14), each on the `.abide` line where the source's text
 * was handed in.
 */
export async function reactiveReads(
    host: ShadowHost,
    sources: readonly (Pick<ParsedSource, 'path' | 'file'> & {
        text?: string
    })[],
): Promise<{ answers: CheckerAnswer[]; warnings: Diagnosis[] }> {
    // Per source, its shadow and what is asked of it, or `undefined` where nothing is declared.
    const queries: ({ map: ShadowMap; projection: Projection } | undefined)[] =
        []
    const edit: ShadowEdit = { created: [], changed: [] }

    // EVERY SOURCE PROJECTS BEFORE ANY SHADOW IS REGISTERED. A projection refuses (a top-level
    // `await`), and a shadow registered ahead of the refusal was in the host with the edit that
    // would have reported it dropped — so the retry found nothing moved, and the checker answered
    // from the old shadow at the new one's offsets, or never had the file at all.
    const projected = sources.map((source) => ({
        source,
        projection: projectShadow(source.file),
    }))
    for (const { source, projection } of projected) {
        // 34.2 — A `<script module>` DECLARES NAMES TOO, and the `<script>` under it is inside
        // that scope on both sides. The projection holds both from offset 0.
        const scripts = projection.text.slice(0, projection.scripts.end)
        // A TEMPLATE POSITION IS A QUESTION TOO (14.2): a file that declares nothing but
        // writes `{format(total)}` has a position only the checker can prove static. And a
        // `<script server>` always is (16.70): what it binds is read off this shadow, re-exported
        // under `PRIVATE_EXPORT`.
        if (
            !DECLARES.test(scripts) &&
            projection.slots.size === 0 &&
            source.file.servers.length === 0
        ) {
            queries.push(undefined)
            continue
        }
        // CANONICAL AT THE KEY, not at the comparison. A doubled separator or a relative
        // path is the same file and a raw string is not the same string — registered as it
        // arrived, the shadow appeared in nobody's directory listing AND named a file the
        // checker could not open, and the refusal blamed the app's tsconfig for it.
        const map = new ShadowMap(
            host.canonical(source.path),
            projection.origins,
        )
        // AN UNCHANGED SHADOW IS NOT REPORTED, which is what a kept session saves on a save:
        // the one page that moved is re-read rather than all of them.
        host.write(map.shadowPath, projection.text, edit)
        host.openOutside(source.path, map.shadowPath, edit)
        queries.push({ map, projection })
    }

    const answered = queries.some((query) => query !== undefined)
        ? await host.ask(
              (project) => fixedPoint(host, project, sources, queries),
              { edit },
          )
        : undefined
    const answers = answered?.answers ?? sources.map(() => UNCHECKED)
    const warnings = answered?.warnings ?? []
    for (let at = 0; at < sources.length; at += 1) {
        const source = sources[at] as (typeof sources)[number]
        if (source.text !== undefined)
            warnings.push(
                ...templateWarnings(
                    source.path,
                    source.text,
                    source.file,
                    answers[at] ?? UNCHECKED,
                ),
            )
    }
    warnings.sort(byPlace)
    return { answers, warnings }
}

/**
 * Each query's answer, round after round, and the warnings each file's last answer earned — a
 * source with no query answered `UNCHECKED`.
 *
 * 31.1 — A BINDING THE PROJECTION TYPED FROM A `Reactive` IS ASKED OF THE PROGRAM IT RUNS AS: each
 * file holding one is lowered with what it has answered so far, and a binding that is a `Reactive`
 * there is one in the projection too. A binding typed from one that just turned out to be a
 * `Reactive` is asked again, until a round turns none. Nothing is asked, and no second snapshot
 * taken, where no file holds one (`readsIn`'s `suspects`).
 */
async function fixedPoint(
    host: ShadowHost,
    first: Project,
    sources: readonly (Pick<ParsedSource, 'path' | 'file'> & {
        text?: string
    })[],
    queries: readonly (
        { map: ShadowMap; projection: Projection } | undefined
    )[],
): Promise<{ answers: CheckerAnswer[]; warnings: Diagnosis[] }> {
    const answers = sources.map(() => UNCHECKED)
    // Per source, its compiler warnings, the bindings the projection could not type, and those the
    // lowered program proved a `Reactive`.
    const warned: Diagnosis[][] = sources.map(() => [])
    const suspects: number[][] = sources.map(() => [])
    const held: Set<number>[] = sources.map(() => new Set())
    const answer = async (
        asked: Project,
        abide: Abide,
        at: number,
    ): Promise<void> => {
        const query = queries[at]
        if (query === undefined) return
        const source = sources[at] as (typeof sources)[number]
        const sourceFile = await host.sourceFile(
            asked,
            query.map.shadowPath,
            source.path,
            'no name in it can be typed (RULEBOOK 31.3)',
        )
        const read = await readsIn(
            asked.checker,
            abide,
            sourceFile,
            query.map.shadowPath,
            query.projection,
            source.file,
            held[at] as Set<number>,
        )
        answers[at] = read.answer
        suspects[at] = read.suspects
        warned[at] = placedFindings(
            source.path,
            source.text,
            read.warnings,
            (offset) => query.map.toSource(query.map.shadowPath, offset),
            'warning',
            true,
        )
    }
    const every = queries.map((_, at) => at)
    const firstAbide = await abideIn(first)
    await Promise.all(every.map((at) => answer(first, firstAbide, at)))
    for (;;) {
        const asking = every.filter(
            (at) => (suspects[at] as number[]).length > 0,
        )
        if (asking.length === 0) break
        const edit: ShadowEdit = { created: [], changed: [] }
        const lowered = asking.map((at) => {
            const source = sources[at] as (typeof sources)[number]
            const query = queries[at] as { map: ShadowMap }
            const shadow = checkedShadow(
                source.file,
                answers[at] as CheckerAnswer,
            )
            host.write(query.map.checkedPath, shadow.text, edit)
            host.openOutside(source.path, query.map.checkedPath, edit)
            return { at, path: query.map.checkedPath, origins: shadow.origins }
        })
        const turned = await host.ask(
            async (asked) => {
                const abide = await abideIn(asked)
                const turning = new Set<number>()
                await Promise.all(
                    lowered.map(async ({ at, path, origins }) => {
                        const sourceFile =
                            await asked.program.getSourceFile(path)
                        if (sourceFile === undefined) return
                        for (const start of suspects[at] as number[]) {
                            const position = mapForward(origins, start)
                            if (position === undefined) continue
                            const symbol =
                                await asked.checker.getSymbolAtLocation(
                                    getTouchingPropertyName(
                                        sourceFile,
                                        position,
                                    ),
                                )
                            if (
                                symbol !== undefined &&
                                (await isReactiveSymbol(
                                    asked.checker,
                                    abide,
                                    symbol,
                                ))
                            ) {
                                ;(held[at] as Set<number>).add(start)
                                turning.add(at)
                            }
                        }
                    }),
                )
                if (turning.size > 0)
                    await Promise.all(
                        [...turning].map((at) => answer(asked, abide, at)),
                    )
                return turning
            },
            { edit },
        )
        // A snapshot the checker opened no project in answers nothing further, and no warning of
        // an earlier round is reported.
        if (turned === undefined) return { answers, warnings: [] }
        if (turned.size === 0) break
        for (const at of asking) if (!turned.has(at)) suspects[at] = []
    }
    return { answers, warnings: warned.flat() }
}
