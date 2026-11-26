import type { Reactive } from './Reactive.ts'

// 10 — `reactive.shared(create)`: a HANDLE, declared once, whose call gets or creates its value in the
// component instance and its descendants (10.3). One call does both (10.1), so there is no "has it" to
// race with a "make it", and the handle's own identity is what its value is filed under — two handles
// are two values, whatever they create.
//
// 10.5 REFUSES A PROCESS-WIDE ONE, and that is what makes this a scope rather than a map. Two
// `<Shelf/>` instances each calling `queued()` hold two values; a `<TrackRow/>` under a page that
// holds `nowPlaying` finds the page's. The difference is the CHAIN, and the chain is the
// component tree — which exists now that a component is invoked rather than written as markup.
//
// A SCOPE PER COMPONENT THAT CALLS A HANDLE, not per component. A file that never calls one needs no
// node of its own: it is a link nothing is filed under, and a descendant's walk passes straight
// through it to the ancestor that does hold the value. The checker finds the call by the handle's
// type (`sharesIn`), so what a page pays for the mechanism is nothing unless it uses it.

export type ShareScope = {
    parent: ShareScope | null
    values: Map<object, unknown>
    /**
     * 39.1 — the routed level the instance stands in, opaque here (`Level`). Carried down the chain
     * so a component mounted after its level — an arm opening, a row grown — finds the level its
     * `<head>` joins through the scope it resumes, as it finds a shared value.
     */
    level: unknown
}

// The instance being rendered or mounted, or `null` outside one. A dynamic scope like
// `TRACKING.reader` is, and for the same reason: the call is made in an author's own setup, which
// cannot be handed a parameter.
let standingShare: ShareScope | null = null

/**
 * What `reactive.shared` hands back: called, the value nearest the calling instance (10.3), created
 * there where no ancestor holds one (10.4).
 *
 * A TYPE LITERAL, as `Reactive` is: every instantiation carries one symbol, which is how the checker
 * finds a component calling a handle and opens its scope (`sharesIn`).
 */
export type Shared<Value> = {
    (): Reactive<Value>
}

/** The value `handle` holds in this instance or its nearest ancestor holding one, or one `create`s here. */
export function shareOf(handle: object, create: () => unknown): unknown {
    const scope = standingShare
    if (scope === null)
        throw new Error(
            'abide: a reactive.shared handle was called outside a component instance, and the scope it would get or create in is that instance. RULEBOOK 10.3.',
        )
    for (let at: ShareScope | null = scope; at !== null; at = at.parent) {
        const held = at.values.get(handle)
        // 10.2 — held for the life of the scope, so a second call in a descendant finds this one
        // rather than building a second value the first one's readers never hear from.
        if (held !== undefined) return held
    }
    // 10.4 — created HERE where no ancestor holds it, which is what makes two siblings two values.
    const made = create()
    scope.values.set(handle, made)
    return made
}

/**
 * Opens a share scope around an emitted component's body, and returns the previous one.
 *
 * The PREVIOUS scope comes back rather than the new one: restoring is the whole of the close
 * (`leaveShare`), and a component that threw still has to restore it. `level` is handed in by a
 * routed level opening its own scope (39.1); every other scope carries its parent's down.
 */
export function enterShare(level?: unknown): ShareScope | null {
    const previous = standingShare
    standingShare = {
        parent: previous,
        values: new Map(),
        level: level ?? previous?.level,
    }
    return previous
}

export function leaveShare(previous: ShareScope | null): void {
    standingShare = previous
}

/**
 * The share scope current now, for an instance to capture at mount and a deferred mount to resume.
 *
 * 10.3 THROUGH A MOUNT THAT HAPPENS LATER. A row the list grows by is mounted from a `watch`
 * effect, not from inside its caller's mount — so nothing is on the stack and `standingShare` is null,
 * and a child that shares would open a chain of its own and miss the key its page holds. The
 * instance captures its own scope at mount and the deferred mount resumes it, which is what makes
 * a row added after the click a descendant of the same page as the rows the server wrote.
 */
export function currentShare(): ShareScope | null {
    return standingShare
}

/**
 * `run(first, second)` with `scope` current, the previous one restored after it however it ends.
 *
 * Two arguments rather than a closure, as `untracked` takes them: a mount resuming its captured
 * scope builds nothing to call through.
 */
export function inShare<First, Second, Result>(
    scope: ShareScope | null,
    run: (first: First, second: Second) => Result,
    first: First,
    second: Second,
): Result {
    const previous = standingShare
    standingShare = scope
    try {
        return run(first, second)
    } finally {
        standingShare = previous
    }
}

/** Makes a captured share scope current again, and returns the previous one to restore. */
export function resumeShare(scope: ShareScope | null): ShareScope | null {
    const previous = standingShare
    standingShare = scope
    return previous
}
