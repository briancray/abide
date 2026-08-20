// The tag registry.
//
// A tag names DATA, not the thing holding it: `invalidate({ tags: ['user:42'] })` reaches every slot
// carrying it without the caller knowing which memo that is. That is why the registry is one
// module-level map rather than a field on each memo — and why the public verbs in `#shared/memo.ts`
// are bare functions with no `fn.` in front of them.
//
// One module-level map, and per-caller slots join it, so what the walk needs beyond the name is
// WHOSE copy each entry is — see `caller` on the entry and `taggedTargets` below.

import { currentScope, type Scope } from './scopes.ts'

/**
 * What either verb can be pointed at: a slot's handle, an argless memo, or a whole memo's
 * no-selector verbs. Exported because `#shared/memo.ts` reaches the same two verbs by DECLARATION as
 * well as by tag, and one shape describing "actable" keeps the two lists from drifting.
 */
export interface Taggable {
    invalidate(): void
    refresh(): void
}

interface TagEntry {
    owner: unknown
    target: Taggable
    /**
     * The caller whose copy this is, or `null` for a copy every caller shares.
     *
     * NOT named `scope`: the public verbs already take a `scope` argument meaning "narrow to one
     * memo's slots", which is `owner` above. Two things called scope in one walk is how the wrong one
     * gets compared.
     *
     * `null` is a `{ global }` memo's slot, or one filled where there was no caller scope at all — a
     * client, a script, a test, where there is one caller forever. Those are the copies everybody
     * shares, so everybody reaches them.
     */
    caller: Scope | null
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
 * Everything carrying any of these tags that THIS CALLER holds. `scope` narrows it to one memo's
 * slots.
 *
 * A caller scope owns its cache and nothing outside it reaches in. A tag names DATA, so reaching
 * every copy of it reads as the right thing to do — and on a server it is how one request's
 * `refresh({ tags })` ran another request's body under the CALLING request's `AsyncLocalStorage`
 * scope, refilling that request's slot from the wrong person's cookies and serving it. Neither verb
 * is a caller's business outside its own cache: an eager re-run lands in a cache that dies with the
 * request that owns it, and dropping a copy that request is still serving is not this caller's call
 * either.
 *
 * `null` — a `{ global }` memo, or no caller scope at all — is a copy everyone shares, so everyone
 * reaches it. That is what the flag already promises: *what genuinely belongs to the process,
 * anything whose answer does not depend on who asked.* A body that does not depend on who asked is
 * one it is harmless to run in whoever's scope called the verb. It is also why a browser is
 * untouched by any of this: with one caller forever, `currentScope()` is null and so is every entry.
 *
 * The COLLECTION only — each public verb walks the result itself. Taking the verb as a parameter
 * meant carrying a name, a branch and two loops to re-derive at runtime what both call sites spell
 * as a literal; and reaching it as `target[verb]()` was a dynamic property access in a walk that is
 * per slot, which for a memo tagged per row is per row.
 */
export function taggedTargets(names: string[], scope: unknown): Set<Taggable> {
    const caller = currentScope()
    // A Set, so a target carrying two of the named tags is still acted on once.
    const hit = new Set<Taggable>()
    for (const name of names) {
        const members = tagged.get(name)
        if (members === undefined) continue
        for (const entry of members) {
            if (entry.caller !== null && entry.caller !== caller) continue
            if (scope === undefined || entry.owner === scope) hit.add(entry.target)
        }
    }
    return hit
}
