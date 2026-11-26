// 11.78, 16.110 — A MEMO'S STORE, AND A HANDLER'S, IS TYPED BY THE VALUE IT KEEPS: a `Store<T>` of
// what the body answers fits, as one inferring nothing (`store.sqlite(db, 'calls')`) does, and a store
// of another value is refused.

import { expect, test } from 'bun:test'

import { rpc } from '#server'
import { memo, type Store } from '#shared'

const kept = (): Store<number[]> => ({ get: () => undefined, set: () => {} })
const untyped = (): Store<unknown> => ({ get: () => undefined, set: () => {} })
const other = (): Store<string> => ({ get: () => undefined, set: () => {} })

test("a memo's and a handler's store take a store typed by the value — 11.78, 16.110", () => {
    // THE REVERT: type `store` as `Store<unknown>` again; the two typed lines fail `bun run typecheck`.
    memo(async (): Promise<number[]> => [1], { store: kept() })
    memo(async (): Promise<number[]> => [1], { store: untyped() })
    memo(async ({ id }: { id: string }): Promise<number[]> => [id.length], {
        store: () => kept(),
    })
    rpc(async (): Promise<number[]> => [1], { store: kept() })
    // @ts-expect-error — a store of another value is refused.
    memo(async (): Promise<number[]> => [1], { store: other() })
    expect(true).toBe(true)
})
