import type { Reactive } from './Reactive.ts'

// 10 — `reactive.share(key, create)`: get-or-create by key, in the component instance and its
// descendants (10.5). One call does both (10.1), so there is no "has it" to race with a "make it".
//
// 10.7 REFUSES A PROCESS-WIDE ONE, and that is what makes this a scope rather than a map. Two
// `<Shelf/>` instances each holding `queued` are two values; a `<TrackRow/>` under a page that
// holds `nowPlaying` finds the page's. The difference is the CHAIN, and the chain is the
// component tree — which exists now that a component is invoked rather than written as markup.
//
// A SCOPE PER COMPONENT THAT SHARES, not per component. A file that never calls this needs no node
// of its own: it is a link nothing is filed under, and a descendant's walk passes straight through
// it to the ancestor that does hold the key. The emitters open one exactly where the call is, so
// what a page pays for the mechanism is nothing unless it uses it.

export type ShareScope = {
    parent: ShareScope | null
    values: Map<string, unknown>
}

// The instance being rendered or mounted, or `null` outside one. A dynamic scope like
// `TRACKING.reader` is, and for the same reason: the call is made in an author's own setup, which
// cannot be handed a parameter.
let CURRENT: ShareScope | null = null

// The app's registry of shared keys, declaration-merged (10.3). Empty here: an app widens it, and
// a key it declares is checked against it where a key it does not is inferred from the thunk.
// biome-ignore lint/suspicious/noEmptyInterface: 10.3 — an app merges its own keys into this.
export interface Shared {}

export function share<Key extends string, Value>(
    key: Key,
    create: () => Reactive<Value>,
): Key extends keyof Shared ? Reactive<Shared[Key]> : Reactive<Value> {
    const scope = CURRENT
    if (scope === null)
        throw new Error(
            `abide: reactive.share('${key}') was called outside a component instance, and the scope it would get or create in is that instance. RULEBOOK 10.5.`,
        )
    for (let at: ShareScope | null = scope; at !== null; at = at.parent) {
        const held = at.values.get(key)
        // 10.4 — held for the life of the scope, so a second call in a descendant finds this one
        // rather than building a second value the first one's readers never hear from.
        if (held !== undefined) return held as never
    }
    // 10.6 — created HERE where no ancestor holds it, which is what makes two siblings two values.
    const made = create()
    scope.values.set(key, made)
    return made as never
}

// What an emitted component opens around its own body, and closes after it. The PREVIOUS scope
// comes back rather than the new one: restoring is the whole of the close, and a component that
// threw still has to restore it.
export function enterShare(): ShareScope | null {
    const previous = CURRENT
    CURRENT = { parent: previous, values: new Map() }
    return previous
}

export function leaveShare(previous: ShareScope | null): void {
    CURRENT = previous
}

// 10.5 THROUGH A MOUNT THAT HAPPENS LATER. A row the list grows by is mounted from a `watch`
// effect, not from inside its caller's mount — so nothing is on the stack and `CURRENT` is null,
// and a child that shares would open a chain of its own and miss the key its page holds. The
// instance captures its own scope at mount and the deferred mount resumes it, which is what makes
// a row added after the click a descendant of the same page as the rows the server wrote.
export function currentShare(): ShareScope | null {
    return CURRENT
}

export function resumeShare(scope: ShareScope | null): ShareScope | null {
    const previous = CURRENT
    CURRENT = scope
    return previous
}
