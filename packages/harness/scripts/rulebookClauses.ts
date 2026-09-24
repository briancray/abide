// THE ONE READING OF RULEBOOK.md, for the two gates that hold citations to it and the report of the
// clauses nothing cites: two readers splitting paragraphs differently are reading two rulebooks.
// A clause opens its own paragraph, its number first.
export function rulebookClauses(
    rulebook: string,
): { id: string; text: string }[] {
    const clauses: { id: string; text: string }[] = []
    for (const paragraph of rulebook.split(/\n\s*\n/)) {
        const clause = /^(\d+\.\d+)\s+([\s\S]*)$/.exec(paragraph.trim())
        if (clause)
            clauses.push({
                id: clause[1] ?? '',
                text: (clause[2] ?? '').replace(/\n/g, ' '),
            })
    }
    return clauses
}

// A clause number where prose cites one. A measurement carries the same digits, so a reader that
// cares tells the two apart by what follows.
export const CITATION = /\b(\d{1,2}\.\d{1,2})\b/g
