/**
 * Whether a lowercased attribute name is an `on<event>` listener.
 *
 * 32.4 — an `on<event>` attribute is a listener, whether the compiler reads it off a tag or a
 * spread hands it over at run time: one predicate, so the two cannot drift on which names are
 * listeners.
 */
export function isEventName(lowerName: string): boolean {
    return lowerName.length > 2 && lowerName.startsWith('on')
}
