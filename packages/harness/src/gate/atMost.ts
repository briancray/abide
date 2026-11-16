// A CEILING, NOT A COUNT. An exact count of what a subject did internally — abide's `wakes` — is a
// claim about the subject's implementation, and an app that pins one breaks on every release that
// moves it without the app's work moving at all. The subject's own gates stay exact, since that
// number is the one they exist to hold; an app holds the number it can be blamed for, as a most.
//
// A plain throw rather than `expect`, so the failure reads from the line making the claim: the stack
// is cut at this function, and every field over its ceiling is named with what it reported, which
// is also what a `gate`'s `worth` looks for in the failure (43.9).

/**
 * Throws naming every field of `record` over its ceiling in `ceilings`, with the value it reported.
 *
 * A ceiling on a field the record carries as absent (`null`, 43.19) throws too: nothing was
 * published to compare.
 */
export function atMost<Counted extends object>(
    record: Counted,
    ceilings: {
        [
            Field in keyof Counted as Counted[Field] extends number | null
                ? Field
                : never
        ]?: number
    },
): void {
    const over: string[] = []
    for (const field of Object.keys(ceilings)) {
        const ceiling = (ceilings as Record<string, number>)[field] as number
        const reported = (record as Record<string, unknown>)[field]
        if (typeof reported !== 'number')
            over.push(
                `${field} has a ceiling of ${ceiling} and the record carries it as ${reported === null ? 'absent' : String(reported)}`,
            )
        else if (reported > ceiling)
            over.push(`${field}: ${reported}, over its ceiling of ${ceiling}`)
    }
    if (over.length === 0) return
    const failure = new Error(`atMost: ${over.join('; ')}`)
    Error.captureStackTrace(failure, atMost)
    throw failure
}
