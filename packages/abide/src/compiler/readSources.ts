import { type CheckerAnswer, UNCHECKED } from './CheckerAnswer.ts'
import { type AbideFile, parseAbide } from './parseAbide.ts'
import type { Refusals } from './Refusals.ts'
import type { Diagnosis, TypeSession } from './TypeSession.ts'

// EVERY COMPILE OF A `.abide` STARTS THE SAME WAY: the text parsed, then every file read by the
// checker in one snapshot. `abide build`, `abide check` and an editor's one file differ only in
// what a refusal does (`Refusals`) — the build stops at it, and a check reports it and goes on with
// the rest.

/** One `.abide`, parsed. `quiet` is read for its props alone and reported on by nobody (33.4). */
export type ParsedSource = {
    path: string
    text: string
    file: AbideFile
    quiet: boolean
}

/** One `.abide` as the emitters and the checked lowering take it: parsed, and answered. */
export type ReadSource<Source extends ParsedSource = ParsedSource> = Source & {
    answer: CheckerAnswer
}

/** Each source parsed, around a source the parser refuses — a quiet one's refusal is nobody's. */
export function parseSources(
    sources: readonly {
        path: string
        text: string
        quiet?: boolean
    }[],
    refusals: Refusals,
): ParsedSource[] {
    const parsed: ParsedSource[] = []
    for (const source of sources) {
        const quiet = source.quiet === true
        let file: AbideFile
        try {
            file = parseAbide(source.text)
        } catch (thrown) {
            if (!quiet) refusals.at(source.path, thrown, source.text)
            continue
        }
        parsed.push({
            path: source.path,
            text: source.text,
            file,
            quiet,
        })
    }
    return parsed
}

/**
 * Each parsed source with the checker's answer, and the compiler's warnings — in one snapshot.
 *
 * ONE SNAPSHOT FOR THE LOT, which is the whole of the compiler's build time (`readsFor`). Where
 * `refusals` collects, a batch that refuses is asked again a file at a time, so which file it was is
 * known and the others still answer; where it throws, so does the batch.
 */
export async function readSources<Source extends ParsedSource>(
    session: TypeSession,
    parsed: readonly Source[],
    refusals: Refusals,
): Promise<{
    read: ReadSource<Source>[]
    warnings: Diagnosis[]
}> {
    try {
        const { answers, warnings } = await session.readsFor(parsed)
        return { read: answered(parsed, answers), warnings }
    } catch (thrown) {
        if (!refusals.collecting) throw thrown
    }
    const read: ReadSource<Source>[] = []
    const warnings: Diagnosis[] = []
    for (const source of parsed)
        try {
            const alone = await session.readsFor([source])
            read.push(...answered([source], alone.answers))
            warnings.push(...alone.warnings)
        } catch (thrown) {
            if (!source.quiet) refusals.at(source.path, thrown)
        }
    return { read, warnings }
}

function answered<Source extends ParsedSource>(
    parsed: readonly Source[],
    answers: readonly CheckerAnswer[],
): ReadSource<Source>[] {
    const read: ReadSource<Source>[] = []
    for (let at = 0; at < parsed.length; at += 1)
        read.push({
            ...(parsed[at] as Source),
            answer: answers[at] ?? UNCHECKED,
        })
    return read
}
