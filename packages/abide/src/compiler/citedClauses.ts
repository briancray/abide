/**
 * Every clause a finding's message cites, in the order it cites them: each number after a
 * `RULEBOOK`, a list (`RULEBOOK 32.14, 32.32.`) included. What `abide-ignore` answers to (14.19)
 * and what the editor links (38.118) — one reading, so the two cannot name different clauses.
 */
export function citedClauses(message: string): string[] {
    const clauses: string[] = []
    for (const citation of message.matchAll(
        /\bRULEBOOK (\d+\.\d+(?:,\s*\d+\.\d+)*)/g,
    ))
        for (const clause of (citation[1] as string).split(/,\s*/))
            clauses.push(clause)
    return clauses
}
