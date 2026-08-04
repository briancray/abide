// An ADOPTED AMBIENT — a value the SERVER resolved that the browser adopts and never mints.
//
// `route()`, `identity()` and `trace()` are all this shape, and each had solved it separately. The code
// said so out loud: the identity holder opened with "Shaped after `routeHolder.ts`, which solves the
// identical problem". Three files stating a resemblance is three files free to drift, and they had:
//
//   • the identity and trace adopters VALIDATED the incoming value and dropped a malformed one; the
//     route setter did not.
//   • `route`/`identity` lived in a reactive `state`, so a binding reading them re-rendered on a nav;
//     `trace` lived as a plain field on the reactive scope, so `{trace()}` rendered once and then
//     showed a stale id forever.
//
// The shape, stated once:
//   READ    — the LADDER: the active request scope's answer, else the adopted one, else the ambient's
//             own policy for "nobody has said". Reactive from the second rung down, so a binding that
//             reads it re-renders when a nav adopts a new value.
//   ADOPT   — from OUTSIDE (the hydration seed, a nav confirm header, a `/__abide/identity` fetch).
//             Untrusted-shaped by construction, so an invalid value is DROPPED and the previous one
//             stands. Never minted here: a client-invented value names something no server agrees with.
//   CLEAR   — reset, for tests and for teardown that must not leak one run into the next.
//
// The ladder used to be the half that was NOT here. CONTEXT.md defines an adopted ambient as reading
// the request scope on the server and the holder in the browser, and that sentence was written out
// three times, in three files, with three different tails — so nothing held the first two rungs in
// step. That is the same failure mode this module's own history narrates one paragraph up.
//
// The four axes that genuinely differ per ambient are PARAMETERS, not variations to be normalized away:
//
//   `isValid`   — how much of the wire shape has to be there. `route` is constructed internally by
//                 `navigate`, never decoded off the wire, so its validator is permissive; `identity`
//                 and `trace` arrive as untrusted text and check accordingly.
//   `changed`   — an EXTRA guard on top of the cell's own identity check, for a value that is decoded
//                 fresh each time. `identity` supplies one (compare by value: every nav decodes a new
//                 principal object, and without it every nav would wake every reader to say nothing
//                 changed). `route` supplies none, so the fresh-object-per-nav identity difference
//                 wakes readers — which is what makes a same-route param nav republish. Opposite
//                 answers to the same question, both correct, which is why it is a parameter.
//   `fromScope` — the SERVER rung. Two of the three just read a field; `trace` also MINTS there, which
//                 is request-scoped by ADR 0026 and is exactly why this is a callback and not a key.
//   `absent`    — what "nobody has said" means, which is where the three legitimately part company:
//                 `route` throws, `identity` returns a frozen floor in the browser and throws on the
//                 server, `trace` answers `undefined`. Its return type flows out through `read()`, so
//                 an ambient that throws reads as `T` and one that does not reads as `T | undefined`.
//
// Lives in `shared/internal` (not `ui`) so `shared/{route,identity,trace}.ts` can read it without
// importing UI code.

import { state } from './reactive.ts'

export interface AdoptedAmbient<T, Absent = undefined> {
    // The read ladder: scope, then adopted, then `absent`. Tracks when called inside an effect/memo —
    // but only once it gets past the scope, since a request's own answer cannot change under it.
    read(): T | Absent
    // The MIDDLE RUNG alone, for a caller asking whether anything has been adopted rather than what the
    // answer is. `read()` cannot serve that question: it consults the scope first and applies `absent`
    // last, so on the server it answers about the request (or throws) and never about adoption.
    // `identity`'s error-message picker is the one caller — "has this runtime ever been adopted into"
    // is how it recognises a client exercised without a `window`.
    adopted(): T | undefined
    // Install a value that arrived from the server. Invalid → dropped, previous stands.
    adopt(value: unknown): void
    // Reset to "nothing adopted".
    clear(): void
}

export function adoptedAmbient<T, Absent = undefined>(options: {
    isValid: (value: unknown) => value is T
    // Optional EXTRA guard. Return false to skip the write entirely (so readers do not wake). Omit it
    // to let the cell's own identity check decide, which is what a caller wants when it hands over a
    // fresh object each time and that freshness IS the change signal.
    changed?: (current: T, next: T) => boolean
    // The request scope's answer, when there is one. Omit for an ambient with no server half.
    fromScope?: () => T | undefined
    // Nothing on either rung. Omit to answer `undefined`; may also throw, which types `read()` as `T`.
    absent?: () => Absent
}): AdoptedAmbient<T, Absent> {
    const cell = state<T | undefined>(undefined)
    const { isValid, changed, fromScope, absent } = options
    return {
        read: (): T | Absent => {
            const scoped = fromScope?.()
            if (scoped !== undefined) return scoped
            const adopted = cell()
            if (adopted !== undefined) return adopted
            return absent?.() as Absent
        },
        adopted: () => cell(),
        adopt: (value: unknown): void => {
            if (!isValid(value)) return
            const current = cell.peek()
            if (current !== undefined && changed !== undefined && !changed(current, value)) return
            cell.set(value)
        },
        clear: (): void => cell.set(undefined),
    }
}
