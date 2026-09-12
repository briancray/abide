// THE CALLABLE A FACTORY HANDS BACK. A `Reactive` must be CALLABLE — REGISTRY's `s`
// row is `() => Stored` and `read()` is the read — so it is a function object with a
// shared prototype, not a class instance.
//
// 11.15 DOES NOT NEED A `Proxy`, AND THAT IS WHAT SETTLED THE SHAPE. "Adoption MUST
// forward members the adopted `Reactive` declares beyond the common face" reads as an
// open-ended member set, and against one a shared prototype loses. The set is not
// open-ended: REGISTRY types `Room` as the common face plus `publish`, the keyed
// memo's forms are common-face names with a widened signature, and only `state`,
// `memo` and `channel` mint a `Reactive` — there is no app-authored subtype anywhere
// in REGISTRY. So what is dynamic is the DELEGATION TARGET, not the member set, and a
// target is a field read.
//
// A `Proxy` would have put an `apply` trap on `s()` — the per-row read from a
// template slot, the hottest call in the design — to serve one name on one producer
// kind. Per-node prototypes give every adopting face a distinct map and make
// `s.pending()` megamorphic. The refusal rests on the CLOSED MEMBER SET, which is
// durable, rather than on a cost nobody measured.
//
// THE ONE THING THAT WOULD FLIP IT is 31.8's second half — "and the value's method
// otherwise" — which IS open-ended. `s.toUpperCase()` is resolvable only from the
// value's type, and if that ever became a RUNTIME question a `Proxy` is the only
// mechanism that works. It is not one today: 31.8 is decided at compile time inside a
// `.abide` file, and outside one an author writes `s().toUpperCase()`. This design
// rests on the compiler keeping that promise.

import { isFailed, REACTIVE } from '../guards.ts'
import type { ReactiveNode } from './ReactiveNode.ts'
import { watch } from './watch.ts'

export type Tail<Stored> = Iterable<Stored> & AsyncIterable<Stored>

export type Disposer = () => void

export type Reactive<
    Stored = undefined,
    Accepted = Stored,
    Failures = never,
    Produced = Stored,
> = {
    (): Stored
    peek(): Stored
    tail(n?: number): Tail<Stored>
    then<Result = Stored>(
        onSettled?: (value: Stored) => Result | PromiseLike<Result>,
        onFailed?: (error: unknown) => Result | PromiseLike<Result>,
    ): Promise<Result>
    catch<Result>(
        onFailed: (error: unknown) => Result | PromiseLike<Result>,
    ): Promise<Stored | Result>
    finally(onSettled: () => void): Promise<Stored>
    [Symbol.asyncIterator](): AsyncIterator<Produced>
    // biome-ignore lint/suspicious/noConfusingVoidType: REGISTRY's signature for this member, and the registry is what an app is typed against.
    set(value: Accepted | Promise<Accepted>): void | Failures
    patch(mutate: (value: Stored) => void): void
    pending(): boolean
    refreshing(): boolean
    done(): boolean
    success(): boolean
    streaming(): boolean
    error(): unknown
    isError<Name extends string>(
        error: unknown,
        name: Name,
    ): error is Extract<Failures, { name: Name }>
    invalidate(): void
    refresh(): void
    // biome-ignore lint/suspicious/noConfusingVoidType: REGISTRY's signature for this member, and the registry is what an app is typed against.
    watch(effect: (value: Stored) => void | Disposer): () => void
    // Reachable from application source and not a name an app author writes. It is
    // what every member reads its receiver from, and REGISTRY owes it a row saying so.
    node: ReactiveNode
}

type Held = { node: ReactiveNode }

// Members read `this.node`, so an extracted `const p = s.pending` loses its receiver.
// The compiler always emits the call form and `watch(s, …)` passes the face itself,
// but that wants a lint rather than being left implicit.
const FACE = Object.assign(Object.create(Function.prototype), {
    [REACTIVE]: true,
    peek(this: Held) {
        return this.node.peek()
    },
    set(this: Held, value: unknown) {
        return this.node.set(value)
    },
    patch(this: Held, mutate: (value: unknown) => void) {
        return this.node.patch(mutate)
    },
    tail(this: Held, depth?: number) {
        return this.node.tail(depth)
    },
    // 1.5 — a `Reactive` IS thenable. The lint below is warning about exactly the
    // property 1.5 requires, and 1.7 is the clause that pays for it: once a
    // `Reactive` is thenable, the thenable test alone no longer tells a load from a
    // value, so every guard that distinguishes the two reads the brand first.
    // biome-ignore lint/suspicious/noThenProperty: RULEBOOK 1.5, and D95 is why.
    then(
        this: Held,
        onSettled?: (value: unknown) => unknown,
        onFailed?: (error: unknown) => unknown,
    ) {
        return this.node.settled().then(onSettled, onFailed)
    },
    // 1.6 — both derive from `s.then` rather than being a second mechanism.
    catch(this: Held, onFailed: (error: unknown) => unknown) {
        return this.node.settled().then(undefined, onFailed)
    },
    finally(this: Held, onSettled: () => void) {
        return this.node.settled().finally(onSettled)
    },
    [Symbol.asyncIterator](this: Held) {
        return this.node.live()
    },
    pending(this: Held) {
        return this.node.pending()
    },
    refreshing(this: Held) {
        return this.node.refreshing()
    },
    done(this: Held) {
        return this.node.done()
    },
    success(this: Held) {
        return this.node.success()
    },
    streaming(this: Held) {
        return this.node.streaming()
    },
    error(this: Held) {
        return this.node.readError()
    },
    // 3.1 — a probe does not throw, and this one is handed whatever a `{:catch}`
    // caught.
    isError(error: unknown, name: string) {
        return isFailed(error) && (error as { name: string }).name === name
    },
    invalidate(this: Held) {
        return this.node.invalidate()
    },
    refresh(this: Held) {
        return this.node.refresh()
    },
    // 12.10 — `watch` narrowed to this `Reactive`, and not a second mechanism.
    // biome-ignore lint/suspicious/noConfusingVoidType: REGISTRY's signature for this member, and the registry is what an app is typed against.
    watch(this: Held, effect: (value: unknown) => void | Disposer) {
        const self = this as unknown as Reactive<unknown>
        return watch(self, () => effect(self()))
    },
})

// TWO ALLOCATIONS AND TWO MAP TRANSITIONS, stated honestly: the arrow is one,
// `setPrototypeOf` is a runtime call and a transition rather than a write, and the
// own-property add is the second transition. `read.node` rather than a captured
// `node` because the arrow would otherwise keep a context cell alive holding the same
// reference the own property already holds — the node stored twice for the object's
// whole lifetime, in a design whose primary currency is allocations per template node.
//
// `setPrototypeOf` on a function object preserves `[[Call]]` — an internal slot, never
// inherited — so `typeof`, `instanceof Function`, `.bind` and `.call` all hold.
export function face<
    Stored = unknown,
    Accepted = Stored,
    Failures = never,
    Produced = Stored,
>(node: ReactiveNode): Reactive<Stored, Accepted, Failures, Produced> {
    const read = (() => read.node.read()) as (() => unknown) & {
        node: ReactiveNode
    }
    Object.setPrototypeOf(read, FACE)
    read.node = node
    return read as unknown as Reactive<Stored, Accepted, Failures, Produced>
}
