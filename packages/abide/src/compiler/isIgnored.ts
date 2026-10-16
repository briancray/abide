import { citedClauses } from './citedClauses.ts'

/**
 * 14.19 — whether the line above `offset` in `text` silences the warning `message`: it holds
 * `abide-ignore` followed by the number of a clause the message cites, in a script comment or a
 * markup one alike. A directive naming another clause silences nothing, so one silence never hides
 * a second warning on the same read.
 */
export function isIgnored(
    text: string,
    offset: number,
    message: string,
): boolean {
    const cited = citedClauses(message)
    if (cited.length === 0) return false
    const lineStart = text.lastIndexOf('\n', offset - 1)
    if (lineStart <= 0) return false
    const above = text.slice(
        text.lastIndexOf('\n', lineStart - 1) + 1,
        lineStart,
    )
    const directive = /abide-ignore((?:[ \t]+\d+\.\d+)+)/.exec(above)
    if (directive === null) return false
    for (const clause of (directive[1] as string).trim().split(/\s+/))
        if (cited.includes(clause)) return true
    return false
}
