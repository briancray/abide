// 16.43 — AN `Rpc` CALL EVALUATES ITS ARGS AT THE CALL: the object a caller handed in is still theirs,
// and a change they make to it after reaches no later run of that entry.

import { expect, test } from 'bun:test'

import { rpc } from '#server'
import { flushSync, watch } from '#shared'
import { reachOf } from '#shared/rpc.ts'

// THE REVERT: hand `createReactive` the caller's `normal` args in `Keyed.reach` rather than
// `heldArgs(normal)`; the refresh runs the body with the mutated object, `[1,2]` where `[1,1]` is due.
test('a refresh runs an entry for the args of its call, not what the caller changed them to — 16.43', async () => {
    const seen: number[] = []
    const echo = rpc(({ x }: { x: number }) => {
        seen.push(x)
        return x
    })
    const args = { x: 1 }
    await echo(args)
    args.x = 2
    const entry = reachOf(echo, { x: 1 }) as unknown as {
        refresh(): void
        (): unknown
    }
    entry.refresh()
    const stop = watch(() => {
        try {
            entry()
        } catch {}
    })
    flushSync()
    await Bun.sleep(10)
    stop()
    expect(JSON.stringify(seen)).toBe('[1,1]')
})
