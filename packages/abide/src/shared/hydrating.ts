// 41.32 — A VALUE WHOSE SERVER ANSWER IS A STAND-IN ANSWERS AS THE SERVER DID WHILE THE PAGE
// HYDRATES, and is written with the browser's answer once it has. `media` and `online` are the two:
// the server cannot know the viewport or the connection, so an `{#if}` choosing by either would pick
// another arm than the server painted, and 41.24 rebuild it with a warning meant for a mismatch
// nobody intended. Held, the painted arm is adopted, and the browser's answer swaps it as any update
// would — however many derived values stand between the value and the `{#if}`.
//
// WRITTEN AT BOTH ENDS rather than decided where the value is built: a derived body runs when it is
// built, and `online` is built at import, long before any page hydrates — so the value is written
// the server's answer when hydration begins, and the browser's when it ends, whenever it was made.
// One built during hydration answers the server's from its body.
//
// In `#shared` because the values are; the router's hydration (`Router.hydrate`) begins and ends it.

type StandIn = {
    value: { set(next: boolean): unknown }
    server: boolean
    browser: () => boolean
}

const HYDRATION: {
    pending: boolean
    standIns: StandIn[]
    waiting: (() => void)[]
} = {
    pending: false,
    standIns: [],
    waiting: [],
}

/** Files a value whose server answer is `server` and whose browser answer `browser` reads. */
export function standIn(
    value: StandIn['value'],
    server: boolean,
    browser: () => boolean,
): void {
    HYDRATION.standIns.push({ value, server, browser })
}

/** Whether a page is hydrating, so a stand-in built now answers the server's answer. */
export function isHydrating(): boolean {
    return HYDRATION.pending
}

/** Settles once the page hydrating now has hydrated; `undefined` where none is hydrating. */
export function hydrated(): Promise<void> | undefined {
    if (!HYDRATION.pending) return undefined
    return new Promise((done) => {
        HYDRATION.waiting.push(done)
    })
}

/** Writes every stand-in the server's answer, until `endHydration`. */
export function beginHydration(): void {
    HYDRATION.pending = true
    for (const held of HYDRATION.standIns) held.value.set(held.server)
}

/** Writes every stand-in the browser's answer. */
export function endHydration(): void {
    if (!HYDRATION.pending) return
    HYDRATION.pending = false
    for (const held of HYDRATION.standIns) held.value.set(held.browser())
    const waiting = HYDRATION.waiting.splice(0)
    for (const done of waiting) done()
}
