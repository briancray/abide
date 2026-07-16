import { afterEach, describe, expect, test } from 'bun:test'
import type { AsyncComputed } from '../src/lib/shared/types/AsyncComputed.ts'
import { createScope } from '../src/lib/ui/createScope.ts'
import { linked } from '../src/lib/ui/linked.ts'
import { CURRENT_SCOPE } from '../src/lib/ui/runtime/CURRENT_SCOPE.ts'
import { SuspenseSignal } from '../src/lib/ui/runtime/SuspenseSignal.ts'
import type { Scope } from '../src/lib/ui/types/Scope.ts'

/*
Regression for the async-cell ORDERING bug: a `linked` cell must draw EXACTLY ONE async-cell
ordinal per construction — the per-scope `nextCellIndex()` counter that forms the local half of
every async cell's warm-seed key (`${scope.id}:${index}`) — independent of whether its seed
suspends (reads a still-pending blocking dep → routes to `createAsyncCell`, which draws the index)
or resolves synchronously (→ a plain `state`).

Whether a `linked` suspends is DATA-dependent and differs across the SSR→client handoff: a blocking
dependency in flight on the server (→ suspend → index drawn) is already warm-adopted on the warm
client (→ sync resolve). Before the fix the sync path drew NO index, so every async cell declared
after a `linked` keyed off-by-one between sides and adopted the WRONG warm seed (the media page's
`grid` adopting the `layout` string). The fix RESERVES the ordinal in the sync fall-through, so the
counter advances identically on both sides. `nextCellIndex()` is a runtime-only affordance (off the
public `Scope` type), so the tests cast to reach it — the same cast `createAsyncCell` uses.
*/
type Counted = Scope & { nextCellIndex: () => number }

afterEach(() => {
    CURRENT_SCOPE.current = undefined
})

describe('linked draws exactly one async-cell ordinal per construction', () => {
    /* The warm-client pass: the blocking dep is already resolved, so the seed runs synchronously and
       `linked` returns a plain `state`. It must STILL reserve its ordinal — index 0 is consumed, so
       the next async cell in the scope draws 1 (matching the server pass below). Fails before the fix
       (the sync path drew nothing → `nextCellIndex()` returned 0). */
    test('the synchronous-resolve path reserves an ordinal', () => {
        const scope = createScope() as Counted
        CURRENT_SCOPE.current = scope

        linked(() => 5)

        expect(scope.nextCellIndex()).toBe(1)
    })

    /* The server pass: the seed reads a still-pending blocking dep and suspends, so `linked` routes to
       `createAsyncCell`, which draws the same index 0. (A stub cell satisfies `SuspenseSignal`'s
       diagnostic field — the suspend branch only checks `instanceof`, never a real pending promise, so
       nothing registers on the SSR barrier.) The downstream draw is 1 too — parity with the sync path. */
    test('the suspend path draws the same single ordinal', () => {
        const scope = createScope() as Counted
        CURRENT_SCOPE.current = scope
        const pendingDep = {} as AsyncComputed<unknown>

        linked(() => {
            throw new SuspenseSignal(pendingDep)
        })

        expect(scope.nextCellIndex()).toBe(1)
    })

    /* The end-to-end alignment the two paths guarantee: whichever way the `linked` between two async
       cells resolves, a downstream cell lands on the identical ordinal — so its warm-seed key matches
       across the handoff. Here the second draw is always 1, never shifted by the linked's path. */
    test('a downstream async cell keys the same index regardless of the linked path', () => {
        const warmClient = createScope() as Counted
        CURRENT_SCOPE.current = warmClient
        linked(() => 'resolved') // sync resolve
        const clientDownstreamIndex = warmClient.nextCellIndex()

        const server = createScope() as Counted
        CURRENT_SCOPE.current = server
        linked(() => {
            throw new SuspenseSignal({} as AsyncComputed<unknown>)
        }) // suspend
        const serverDownstreamIndex = server.nextCellIndex()

        expect(clientDownstreamIndex).toBe(serverDownstreamIndex)
        expect(serverDownstreamIndex).toBe(1)
    })
})
