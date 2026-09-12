// THE UNKEYED FACTORY. 11.1 — a body declaring no parameter produces an unkeyed,
// tracked `Reactive`; 11.2's keyed form is a different thing entirely and 11.3
// forbids an option converting one into the other.

import { face, type Reactive } from './face.ts'
import { PENDING } from './REACTIVE_FLAGS.ts'
import { attachReader, type NodeOptions, ReactiveNode } from './ReactiveNode.ts'
import type { ReactiveOptions } from './state.ts'

// `Awaited<Computed>` rather than REGISTRY's bare `AdoptedValue<Computed>`: 11.11
// makes a body returning an unsettled value a LOAD, so a body handing back
// `Promise<User>` stores a `User`, and the declared alias unwraps a `Reactive` and
// not a promise. The row is owed the second unwrap.
export function memo<Computed, Stored = Awaited<Computed>, Failures = never>(
    body: () => Computed,
    options?: ReactiveOptions<Awaited<Computed>, Stored, Failures>,
): Reactive<Stored, Awaited<Computed>, Failures> {
    if (body.length > 0)
        throw new Error(
            'The keyed `memo` form is phase 6 of docs/plans/REACTIVE.md and has not landed. A body declaring one parameter produces a keyed `Memo` (11.2), which holds one entry per `Args` key.',
        )
    // 11.61 — a `memo` reports `s.pending` before its body has run for the value
    // being probed, and 3.2 forbids a probe starting the work that would clear it. So
    // the node opens PENDING and the FIRST READ is what runs the body: lazy, which is
    // also 5.2's own mechanism, an eager push being what wakes readers for values
    // that did not change.
    const node = new ReactiveNode(
        (options ?? {}) as NodeOptions,
        false,
        PENDING,
    )
    attachReader(node, body as () => unknown)
    return face<Stored, Awaited<Computed>, Failures>(node)
}
