import { type CheckerAnswer, UNCHECKED } from './CheckerAnswer.ts'
import { diagnosisAt } from './lineOf.ts'
import { type AbideFile, parseAbide } from './parseAbide.ts'
import type { Diagnosis, TypeSession } from './TypeSession.ts'

// EVERY COMPILE OF A `.abide` STARTS THE SAME WAY: the text parsed, then every file read by the
// checker in one snapshot. `abide build`, `abide check` and an editor's one file differ only in
// what a refusal does — the build stops at it, and a check reports it and goes on with the rest.

/** One `.abide`, parsed. `quiet` is read for its props alone and reported on by nobody (33.4). */
export type ParsedSource = {
    path: string
    text: string
    file: AbideFile
    quiet: boolean
}

/** One `.abide` as the emitters and the checked lowering take it: parsed, and answered. */
export type ReadSource = ParsedSource & { answer: CheckerAnswer }

/**
 * Each source parsed.
 *
 * WITH `refused`, A SOURCE THE PARSER REFUSES IS A FINDING, at its first line, and the rest are
 * parsed around it — a quiet one's is nobody's. Without it the refusal is thrown, as a build stops.
 */
export function parseSources(
    sources: readonly { path: string; text: string; quiet?: boolean }[],
    refused?: Diagnosis[],
): ParsedSource[] {
    const parsed: ParsedSource[] = []
    for (const source of sources) {
        const quiet = source.quiet === true
        let file: AbideFile
        try {
            file = parseAbide(source.text)
        } catch (thrown) {
            if (refused === undefined) throw thrown
            if (!quiet) refused.push(refusal(source.path, thrown))
            continue
        }
        parsed.push({ path: source.path, text: source.text, file, quiet })
    }
    return parsed
}

/**
 * Each parsed source with the checker's answer, and the compiler's warnings — in one snapshot.
 *
 * ONE SNAPSHOT FOR THE LOT, which is the whole of the compiler's build time (`readsFor`). WITH
 * `refused`, a batch that refuses is asked again a file at a time, so which file it was is known
 * and the others still answer; without it the refusal is thrown.
 */
export async function readSources(
    session: TypeSession,
    parsed: readonly ParsedSource[],
    refused?: Diagnosis[],
): Promise<{ read: ReadSource[]; warnings: Diagnosis[] }> {
    try {
        const { answers, warnings } = await session.readsFor(parsed)
        return { read: answered(parsed, answers), warnings }
    } catch (thrown) {
        if (refused === undefined) throw thrown
    }
    const read: ReadSource[] = []
    const warnings: Diagnosis[] = []
    for (const source of parsed)
        try {
            const alone = await session.readsFor([source])
            read.push(...answered([source], alone.answers))
            warnings.push(...alone.warnings)
        } catch (thrown) {
            if (!source.quiet) refused.push(refusal(source.path, thrown))
        }
    return { read, warnings }
}

function answered(
    parsed: readonly ParsedSource[],
    answers: readonly CheckerAnswer[],
): ReadSource[] {
    const read: ReadSource[] = []
    for (let at = 0; at < parsed.length; at += 1)
        read.push({
            ...(parsed[at] as ParsedSource),
            answer: answers[at] ?? UNCHECKED,
        })
    return read
}

/** A refusal as a finding at the first line of the file it was refused in. */
export function refusal(path: string, thrown: unknown): Diagnosis {
    return diagnosisAt(
        path,
        undefined,
        0,
        'error',
        thrown instanceof Error ? thrown.message : String(thrown),
    )
}
