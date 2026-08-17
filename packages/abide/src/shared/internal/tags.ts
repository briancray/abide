// The tag registry.
//
// A tag names DATA, not the thing holding it: `invalidate({ tags: ['user:42'] })` reaches every slot
// carrying it without the caller knowing which memo that is. That is why the registry is one
// module-level map rather than a field on each memo — and why the public verbs in `$shared/memo.ts`
// are bare functions with no `fn.` in front of them.

interface Taggable {
    invalidate(): void
    refresh(): void
}

interface TagEntry {
    owner: unknown
    target: Taggable
}

const tagged = new Map<string, Set<TagEntry>>()

/**
 * Returns the way OUT. A memo declared at module scope joins for the life of the process and never
 * uses it; a per-caller instance is created per request, so leaving is what stops the registry — a
 * module-level map holding strong references — growing by one entry per request forever.
 *
 * The NAME leaves with the last entry carrying it, not just the entry: names are resolved per slot
 * from the args (`tags: ({ id }) => [\`user:${id}\`]`), so on a server "distinct name" is "distinct
 * row ever asked for", and dropping only the entry left an empty Set behind for each one.
 */
export function joinTags(names: string[], entry: TagEntry): () => void {
    for (const name of names) {
        let members = tagged.get(name)
        if (members === undefined) {
            members = new Set()
            tagged.set(name, members)
        }
        members.add(entry)
    }
    return () => {
        for (const name of names) {
            const members = tagged.get(name)
            if (members === undefined) continue
            members.delete(entry)
            if (members.size === 0) tagged.delete(name)
        }
    }
}

/**
 * Everything carrying any of these tags. `scope` narrows it to one memo's slots.
 *
 * The COLLECTION only — each public verb walks the result itself. Taking the verb as a parameter
 * meant carrying a name, a branch and two loops to re-derive at runtime what both call sites spell
 * as a literal; and reaching it as `target[verb]()` was a dynamic property access in a walk that is
 * per slot, which for a memo tagged per row is per row.
 */
export function taggedTargets(names: string[], scope: unknown): Set<Taggable> {
    // A Set, so a target carrying two of the named tags is still acted on once.
    const hit = new Set<Taggable>()
    for (const name of names) {
        const members = tagged.get(name)
        if (members === undefined) continue
        for (const entry of members) {
            if (scope === undefined || entry.owner === scope) hit.add(entry.target)
        }
    }
    return hit
}
