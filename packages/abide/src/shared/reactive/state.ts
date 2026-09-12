// THE FACTORY FOR A VALUE THE SCOPE OWNS. Construction and nothing else: every clause
// about what a write does is `ReactiveNode`'s, and every clause about what a read
// does is the face's.

import { face, type Reactive } from './face.ts'
import { type NodeOptions, ReactiveNode } from './ReactiveNode.ts'
import type { Schema } from './validate.ts'

export type Transformer<Accepted, Stored, Failures = never> = (
    value: Accepted,
) => Stored | Failures

export type Store<Stored> = {
    get: () => Stored | Promise<Stored>
    set: (value: Stored, retention: { ttl: number }) => void | Promise<void>
}

export type ReactiveOptions<
    Accepted = unknown,
    Stored = Accepted,
    Failures = never,
> = {
    schema?: Schema<Accepted>
    transform?: Transformer<Accepted, Stored, Failures>
    store?: Store<Stored>
    identity?:
        | ((value: Stored) => unknown)
        | ((next: Stored, previous: Stored) => boolean)
    tail?: number
    ttl?: number
}

export function state<Accepted, Stored = Accepted, Failures = never>(
    initial: Accepted | Promise<Accepted>,
    options?: ReactiveOptions<Accepted, Stored, Failures>,
): Reactive<Stored, Accepted, Failures> {
    const node = new ReactiveNode((options ?? {}) as NodeOptions, false, 0)
    // 4.1 and 4.2 — the factory takes the same two things a write does, and a load
    // given to either makes the `Reactive` loaded at construction and at every write
    // alike. Routing construction through the write path is what makes that one
    // mechanism rather than two, and it is also 3.11: a settled `initial` produces
    // here and synchronously, so `s.success` is true from construction.
    node.set(initial)
    return face<Stored, Accepted, Failures>(node)
}
