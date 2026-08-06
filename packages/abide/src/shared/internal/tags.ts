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
        for (const name of names) tagged.get(name)?.delete(entry)
    }
}

/** Act on everything carrying any of these tags. `scope` narrows it to one memo's slots. */
export function byTag(names: string[], scope: unknown, verb: keyof Taggable): void {
    // A Set, so a target carrying two of the named tags is still acted on once.
    const hit = new Set<Taggable>()
    for (const name of names) {
        const members = tagged.get(name)
        if (members === undefined) continue
        for (const entry of members) {
            if (scope === undefined || entry.owner === scope) hit.add(entry.target)
        }
    }
    for (const target of hit) target[verb]()
}
