// An ADOPTED AMBIENT — a value the SERVER resolved that the browser adopts and never mints.
//
// `route()`, `identity()` and `trace()` are all this shape, and each had solved it separately. The code
// said so out loud: `identityHolder.ts` opened with "Shaped after `routeHolder.ts`, which solves the
// identical problem", and `adoptTrace.ts` with "The counterpart to `adoptTrace`". Three files stating a
// resemblance is three files free to drift, and they had:
//
//   • `adoptIdentity`/`adoptTrace` VALIDATED the incoming value and dropped a malformed one;
//     `setClientRoute` did not.
//   • `route`/`identity` lived in a reactive `state`, so a binding reading them re-rendered on a nav;
//     `trace` lived as a plain field on the reactive scope, so `{trace()}` rendered once and then
//     showed a stale id forever.
//
// The shape, stated once:
//   READ    — reactive, so a binding that reads it re-renders when it changes.
//   ADOPT   — from OUTSIDE (the hydration seed, a nav confirm header, a `/__abide/identity` fetch).
//             Untrusted-shaped by construction, so an invalid value is DROPPED and the previous one
//             stands. Never minted here: a client-invented value names something no server agrees with.
//   CLEAR   — reset, for tests and for teardown that must not leak one run into the next.
//
// The two axes that genuinely differ per ambient are PARAMETERS, not variations to be normalized away:
//
//   `isValid` — how much of the wire shape has to be there. `route` is constructed internally by
//               `navigate`, never decoded off the wire, so its validator is permissive; `identity` and
//               `trace` arrive as untrusted text and check accordingly.
//   `changed` — an EXTRA guard on top of the cell's own identity check, for a value that is decoded
//               fresh each time. `identity` supplies one (compare by value: every nav decodes a new
//               principal object, and without it every nav would wake every reader to say nothing
//               changed). `route` supplies none, so the fresh-object-per-nav identity difference wakes
//               readers — which is what makes a same-route param nav republish. Opposite answers to the
//               same question, both correct, which is why it is a parameter.
//
// Lives in `shared/internal` (not `ui`) so `shared/{route,identity,trace}.ts` can read it without
// importing UI code. Inert on the server, where nothing ever adopts.

import { state } from './reactive.ts'

export interface AdoptedAmbient<T> {
    // Reactive read. Tracks when called inside an effect/memo.
    read(): T | undefined
    // Install a value that arrived from the server. Invalid → dropped, previous stands.
    adopt(value: unknown): void
    // Reset to "nothing adopted".
    clear(): void
}

export function adoptedAmbient<T>(options: {
    isValid: (value: unknown) => value is T
    // Optional EXTRA guard. Return false to skip the write entirely (so readers do not wake). Omit it
    // to let the cell's own identity check decide, which is what a caller wants when it hands over a
    // fresh object each time and that freshness IS the change signal.
    changed?: (current: T, next: T) => boolean
}): AdoptedAmbient<T> {
    const cell = state<T | undefined>(undefined)
    const changed = options.changed
    return {
        read: () => cell(),
        adopt: (value: unknown): void => {
            if (!options.isValid(value)) return
            const current = cell.untracked()
            if (current !== undefined && changed !== undefined && !changed(current, value)) return
            cell.set(value)
        },
        clear: (): void => cell.set(undefined),
    }
}
