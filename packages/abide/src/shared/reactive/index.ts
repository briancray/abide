// THE ONE FACTORY, and the barrel it is the address of. `state`, `memo` and `channel`
// collapsed into overloads on one name — a channel being a value declaring `history` —, and the refusal behind that split
// survives rather than being reversed: what it refused was ONE SIGNATURE WITH AN
// OPTIONAL PARAMETER, not one name, and three overloads handing back two result types
// is the shape its reason forces.
//
// THE ORDER IS FORCED, and getting it wrong breaks the design silently: `() => C` is
// assignable to `(args: A) => C` but not the reverse, so keyed-first swallows the
// unkeyed form whole. Value last means a function argument never reaches it, so a
// function the app wants to STORE rather than run goes inside a record.
//
// The factory lives in the folder's address rather than in a file of its own: `reactive`
// and `Reactive` differ only in case, and a case-insensitive filesystem makes those one
// file (TS1149). An address is the one name CLAUDE.md's file-naming rule exempts.

import type { Failed } from '../Failed.ts'
import { createKeyed, type Keyed } from './Keyed.ts'
import { NO_INITIAL } from './NO_INITIAL.ts'
import {
    busyOverTags,
    createReactive,
    invalidateOverTags,
    isReactive,
    type Reactive,
    type ReactiveOptions,
    readyOverTags,
    refreshOverTags,
} from './Reactive.ts'
import { share } from './share.ts'

export { canonicalKey } from './canonicalKey.ts'
export type { History } from './History.ts'
export { isThenable } from './isThenable.ts'
export { isKeyed, type Keyed } from './Keyed.ts'
export { NotLanded } from './NotLanded.ts'
export {
    flushSync,
    type Identity,
    isReactive,
    type Reactive,
    type ReactiveOptions,
    type Store,
    type Transformer,
} from './Reactive.ts'
export {
    enterShare,
    leaveShare,
    type Shared,
    type ShareScope,
} from './share.ts'
export { structural } from './structural.ts'
export { type Disposer, type Effect, watch } from './watch.ts'

// WHAT A STATIC PROBE MAY BE ASKED ABOUT. Both result types already carry the four
// members, and a `Keyed` already applies the right quantifier over its entries — ANY
// for `busy`, ALL for `ready` — so the selection is the shape rather than a union, and
// the statics have no arm to pick.
//
// 13.1'S LAST ARM IS `{ tags }`: every value carrying any of those tags, across values.
export type Selection =
    | {
          busy(): boolean
          ready(): boolean
          refresh(): void
          invalidate(): void
      }
    | { tags: string[] }

// A `Reactive` and a `Keyed` are both functions, so an object is the tag arm.
function tagsOf(selection: Selection): string[] | null {
    return typeof selection === 'object'
        ? (selection as { tags: string[] }).tags
        : null
}

function named(name: string, selection: Selection | undefined): Selection {
    if (selection === undefined)
        throw new Error(
            `${name}() was called with no selection. The bare form sweeps every entry in scope and is not built yet; name the value or the keyed face.`,
        )
    return selection
}

// WHAT A `transform` HANDS BACK, SPLIT BY WHAT IT IS. A refusal is told apart structurally at run
// time (15.6), and the types split the return the same way: one parameter, `Shaped`, is inferred
// from the whole return and the stored value and the failures are read off it. Two parameters —
// `Stored | Failures` — cannot be inferred from one union: the checker put all of it in `Stored`,
// so a refusing transform stored its own refusal and `s.error()` lost the name it refused with.
type Refusal = Failed<string, unknown>
export type Kept<Shaped> = Exclude<Shaped, Refusal>
export type Refused<Shaped> = Extract<Shaped, Refusal>
// `transform` ALONE IS WHERE `Shaped` IS READ FROM. The rest of the options mention the stored value
// too — a `store`, an `identity` — and inferring from those as well made a `store` whose `get` is
// typed `never` pin the stored value to `never`.
type Shaping<Accepted, Shaped, Args = never> = Omit<
    ReactiveOptions<Accepted, Kept<NoInfer<Shaped>>, never, Args>,
    'transform'
> & {
    transform?: (value: Accepted) => Shaped
}
// What a body handing back a `Reactive` adopts (11.12): its failures, and its chunks where it streams.
export type AdoptedFailures<Computed> =
    Computed extends Reactive<unknown, never, infer Failures, unknown>
        ? Failures
        : never
export type AdoptedProduced<Computed, Otherwise> =
    Computed extends Reactive<unknown, never, unknown, infer Produced>
        ? Produced
        : Otherwise

// THE STREAMING OVERLOADS COME FIRST, and for the reason the keyed one comes after the
// unkeyed: `() => AsyncGenerator<Chunk>` is a `() => Computed`, so the general form would
// type a stream as holding its generator. The TYPE reads the return; what 9.20 reads at run
// time is the function's kind, and an arrow handing back a generator types as a stream and
// runs as a value — the one place the two readings part, closed by writing `async function*`.
export function reactive<Chunk, Shaped = Chunk[]>(
    body: () => AsyncGenerator<Chunk>,
    options?: Shaping<Chunk[], Shaped>,
): Reactive<Kept<Shaped>, Chunk[], Refused<Shaped>, Chunk>
export function reactive<Chunk, Args, Shaped = Chunk[]>(
    body: (args: Args) => AsyncGenerator<Chunk>,
    options?: Shaping<Chunk[], Shaped, Args>,
): Keyed<Kept<Shaped>, Args, Chunk[], Refused<Shaped>, Chunk>
export function reactive<Computed, Shaped = Awaited<Computed>>(
    body: () => Computed,
    options?: Shaping<Awaited<Computed>, Shaped>,
): Reactive<
    Kept<Shaped>,
    Awaited<Computed>,
    AdoptedFailures<Computed> | Refused<Shaped>,
    AdoptedProduced<Computed, Kept<Shaped>>
>
export function reactive<Computed, Args, Shaped = Awaited<Computed>>(
    body: (args: Args) => Computed,
    options?: Shaping<Awaited<Computed>, Shaped, Args>,
): Keyed<
    Kept<Shaped>,
    Args,
    Awaited<Computed>,
    AdoptedFailures<Computed> | Refused<Shaped>,
    AdoptedProduced<Computed, Kept<Shaped>>
>
export function reactive<Accepted, Shaped = Accepted>(
    // Optional: `reactive<User>()` is a value nothing has written yet, not ready until the first
    // `set` (2.10). A function to STORE rather than run is wrapped — `reactive({ handler })` —
    // since a function here is a body.
    initial?: Accepted | PromiseLike<Accepted>,
    options?: Shaping<Accepted, Shaped>,
): Reactive<Kept<Shaped>, Accepted, Refused<Shaped>>
export function reactive(
    // A REST TUPLE rather than two parameters, so the count of what was passed is read: 4.14 has no
    // argument land nothing where 4.15 has `undefined` land `undefined`.
    //
    // `unknown` RATHER THAN A `ReactiveOptions`, and it is the overloads that force it: a
    // spelling concrete enough to pass straight through — any of `<unknown, unknown>`,
    // `<never, unknown, never>`, `<never, never, never>` — is one the three overloads are
    // not all assignable to, once `Failures` carries a bound. The implementation signature
    // is the bridge nothing calls directly, so the casts below are where the three
    // overloads' promises are made good.
    ...given: [first?: unknown, options?: unknown]
): unknown {
    const [first, options] = given
    if (typeof first === 'function' && !isReactive(first)) {
        const body = first as (args?: unknown) => unknown
        // The two body forms are told apart by ARITY, which is the discriminator that
        // refusing an optional parameter was protecting: a declared parameter is the
        // author saying this value is keyed.
        if (body.length >= 1)
            return createKeyed(
                'reactive',
                body,
                (options ?? undefined) as Parameters<typeof createKeyed>[2],
            )
        return createReactive(
            'reactive',
            body as (args: unknown) => unknown,
            undefined,
            undefined,
            options as Parameters<typeof createReactive>[4],
        )
    }
    return createReactive(
        'reactive',
        null,
        undefined,
        // 4.14 AGAINST 4.15: called with no argument is empty, and called with `undefined` is loaded.
        given.length === 0 ? NO_INITIAL : first,
        options as Parameters<typeof createReactive>[4],
    )
}

// What a pattern beside a selection is typed as: the `Args` the selection's OWN member narrows by
// (13.12), read off the member being called rather than off `refresh` for all four — the four take
// the same two arguments, and deriving three of them from a fourth is one member's signature
// standing in for another's. A `Reactive`'s members take none, so a pattern there is inert; the
// tag arm takes none at all.
type PatternOf<
    Chosen,
    Member extends 'busy' | 'ready' | 'refresh' | 'invalidate',
> =
    Chosen extends Record<Member, (pattern?: infer Pattern) => unknown>
        ? Pattern
        : never

// THE FREE PROBES AND TRIGGERS. 3.2 keeps a probe from starting work and 1.7 has reaching an
// instance start it, so the allocate/do-not-allocate split is visible in the spelling rather than
// remembered as a rule. A pattern is handed to the selection's own face, which is what narrows a
// `Keyed` and an `Rpc` over one — so `refresh(s, pattern)` and `s.refresh(pattern)` are one call
// (13.4, 13.12).
export function busy<Chosen extends Selection>(
    selection?: Chosen,
    pattern?: PatternOf<Chosen, 'busy'>,
): boolean {
    const chosen = named('busy', selection)
    const tags = tagsOf(chosen)
    if (tags !== null) return busyOverTags(tags)
    return (chosen as { busy(pattern: unknown): boolean }).busy(pattern)
}
// ALL, against `busy`'s ANY. The ambiguity stood declared rather than resolved for a
// long time; these are the quantifiers under which `busy && !ready` reads as one
// sentence.
export function ready<Chosen extends Selection>(
    selection?: Chosen,
    pattern?: PatternOf<Chosen, 'ready'>,
): boolean {
    const chosen = named('ready', selection)
    const tags = tagsOf(chosen)
    if (tags !== null) return readyOverTags(tags)
    return (chosen as { ready(pattern: unknown): boolean }).ready(pattern)
}
export function refresh<Chosen extends Selection>(
    selection?: Chosen,
    pattern?: PatternOf<Chosen, 'refresh'>,
): void {
    const chosen = named('refresh', selection)
    const tags = tagsOf(chosen)
    if (tags !== null) refreshOverTags(tags)
    else (chosen as { refresh(pattern: unknown): void }).refresh(pattern)
}
export function invalidate<Chosen extends Selection>(
    selection?: Chosen,
    pattern?: PatternOf<Chosen, 'invalidate'>,
): void {
    const chosen = named('invalidate', selection)
    const tags = tagsOf(chosen)
    if (tags !== null) invalidateOverTags(tags)
    else (chosen as { invalidate(pattern: unknown): void }).invalidate(pattern)
}

// 10.1 — `reactive.share` is a static on the factory rather than a free name, the registry's own
// spelling: it CREATES where nothing holds the key, so it belongs with the factory it calls.
reactive.share = share
