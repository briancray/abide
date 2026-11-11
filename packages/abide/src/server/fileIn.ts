/**
 * Files `member` in the set `sets` holds under `key`; the returned function takes it out, and drops
 * the set — then calls `emptied` — once it was the last.
 *
 * AN UNDO RUN TWICE IS A NO-OP: the second finds `member` gone and returns, rather than dropping a
 * newer set filed under the same key since.
 */
export function fileIn<Member>(
    sets: Map<string, Set<Member>>,
    key: string,
    member: Member,
    emptied: (() => void) | undefined,
): () => void {
    let members = sets.get(key)
    if (members === undefined) {
        members = new Set()
        sets.set(key, members)
    }
    members.add(member)
    return () => {
        if (!members.delete(member)) return
        if (members.size > 0) return
        sets.delete(key)
        emptied?.()
    }
}
