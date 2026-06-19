/* Normalizes a tags option (one tag or many) to a Set for O(1) membership. */
export function toTagSet(tags: string | string[]): Set<string> {
    return new Set(typeof tags === 'string' ? [tags] : tags)
}
