/**
 * Issues in the shape `Issues<T>` gives them for the value refused: by path for an object or an
 * array, the bare list for anything else.
 *
 * DECIDED BY THE VALUE, because the value is all the runtime holds — `T` is erased. A scalar has
 * no path to key by, so every issue about one stands on `''`, and handing back `{ '': [...] }`
 * there is the wrapper `Issues<T>` says a reader never unwraps: `error().data[0]` read `undefined`.
 */
export function issuesOf(
    found: Record<string, string[]>,
    value: unknown,
): Record<string, string[]> | string[] {
    if (typeof value === 'object' && value !== null) return found
    const listed: string[] = []
    for (const path in found)
        for (const said of found[path] as string[]) listed.push(said)
    return listed
}
