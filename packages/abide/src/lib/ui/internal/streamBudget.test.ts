// SOURCE-DERIVED SSR STREAM BUDGET (replayable-streams.md §6, build-order step 5).
//
// The `{#for await}` SSR streamer applies the last-resort global `ABIDE_SSR_STREAM_BUDGET` ONLY to a
// NON-abide source (a raw generator / `fetch().body`) — the one thing abide can't otherwise bound. An
// ABIDE RPC source (`attachable`, tagged by the emitter when the head resolves to a known RPC import)
// is bounded by its OWN bilateral RPC timeout, so it gets NO global cap: firing the budget must not cut
// it off. These tests drive the streamer generator directly with a MANUALLY-controlled source + budget
// (no wall-clock racing) so the branch is proven deterministically.

import { expect, test } from 'bun:test'
import {
    createContext,
    runInContext,
    type StreamFrame,
    type StreamScope,
} from '../../shared/internal/context.ts'
import { type ForAwaitStreamConfig, forAwaitStream } from './streamScope.ts'

// A StreamScope whose deadline has already passed (so `forAwaitStream` takes the streaming path
// immediately) and whose budget is a promise the test resolves on demand.
function manualScope(): { scope: StreamScope; fireBudget: () => void } {
    let fireBudget!: () => void
    const budgetPromise = new Promise<symbol>((resolve) => {
        fireBudget = () => resolve(Symbol('abide.ssr.budget'))
    })
    const scope: StreamScope = {
        deadlinePassed: Promise.resolve(Symbol('abide.ssr.deadline')),
        budget: () => budgetPromise,
        deferred: [],
        streamers: [],
        streamHandles: [],
        nextId: 0,
    }
    return { scope, fireBudget }
}

// A source whose every `next()` resolves only when the test calls `emit`/`end`, in creation order (FIFO).
function manualSource(): {
    source: AsyncIterable<string>
    emit: (value: string) => void
    end: () => void
} {
    const resolvers: Array<(result: IteratorResult<string>) => void> = []
    let pending: {
        promise: Promise<IteratorResult<string>>
        resolve: (result: IteratorResult<string>) => void
    }
    const arm = () => {
        let resolve!: (result: IteratorResult<string>) => void
        const promise = new Promise<IteratorResult<string>>((r) => {
            resolve = r
        })
        resolvers.push(resolve)
        return { promise, resolve }
    }
    pending = arm()
    const iterator: AsyncIterator<string> = {
        next(): Promise<IteratorResult<string>> {
            const current = pending
            pending = arm()
            return current.promise
        },
    }
    const source: AsyncIterable<string> = { [Symbol.asyncIterator]: () => iterator }
    let cursor = 0
    return {
        source,
        emit: (value: string) => {
            const resolve = resolvers[cursor++]
            if (resolve === undefined) throw new Error('no pending resolver to emit')
            resolve({ value, done: false })
        },
        end: () => {
            const resolve = resolvers[cursor++]
            if (resolve === undefined) throw new Error('no pending resolver to end')
            resolve({ value: undefined as unknown as string, done: true })
        },
    }
}

// Register a `{#for await}` streamer through `forAwaitStream` and return the shell + the streamer's
// frame generator so a test can drive it item-by-item.
async function startStreamer(
    attachable: boolean,
    src: AsyncIterable<string>,
): Promise<{
    scope: StreamScope
    fireBudget: () => void
    shell: string
    frames: AsyncGenerator<StreamFrame>
}> {
    const { scope, fireBudget } = manualScope()
    const ctx = createContext()
    ctx.stream = scope
    const config: ForAwaitStreamConfig = {
        source: () => src,
        renderItem: async (value) => `<li>${String(value)}</li>`,
        caught: null,
        attachable,
    }
    if (attachable) {
        config.rpcName = 'complete'
        config.args = async () => ({ n: 3 })
    }
    let shell = ''
    await runInContext(ctx, async () => {
        shell = await forAwaitStream(config)
    })
    expect(scope.streamers.length).toBe(1)
    const streamer = scope.streamers[0]
    if (streamer === undefined) throw new Error('expected a registered streamer')
    return { scope, fireBudget, shell, frames: streamer.run() }
}

test('an abide RPC source ignores the budget — firing it does not cut the stream off', async () => {
    const src = manualSource()
    const { scope, fireBudget, shell, frames } = await startStreamer(true, src.source)
    expect(shell).toContain('<abide-list')
    expect(shell).toContain('data-ab-count="0"') // attachable → count attr present

    // Fire the budget IMMEDIATELY: an abide source never consults it, so the stream must still run.
    fireBudget()

    const first = frames.next() // streamer awaits the source's first item (no budget race)
    src.emit('t0')
    expect((await first).value).toEqual({ op: 'append', html: '<li>t0</li>' })

    const second = frames.next()
    src.emit('t1')
    expect((await second).value).toEqual({ op: 'append', html: '<li>t1</li>' })

    const third = frames.next()
    src.end() // source closes within its own bound → complete, not cut off
    expect((await third).value).toEqual({ op: 'complete' })

    // The handoff record is finalized as a completed transcript (mode A).
    expect(scope.streamHandles.length).toBe(1)
    const handle = scope.streamHandles[0]
    if (handle === undefined) throw new Error('expected a stream handle')
    expect(handle.done).toBe(true)
    expect(handle.count).toBe(2)
    expect(handle.values).toEqual(['t0', 't1'])
})

test('a non-abide source is cut off when the budget fires (client re-iterates)', async () => {
    const src = manualSource()
    const { scope, fireBudget, shell, frames } = await startStreamer(false, src.source)
    expect(shell).toContain('<abide-list')
    expect(shell).not.toContain('data-ab-count') // non-attachable → no handoff markers
    expect(scope.streamHandles.length).toBe(0)

    // One item streams, then the budget fires while the next item is still pending → cut off.
    const first = frames.next()
    src.emit('t0')
    expect((await first).value).toEqual({ op: 'append', html: '<li>t0</li>' })

    const cut = frames.next() // races the (still-pending) next item against the budget
    fireBudget()
    const result = await cut
    expect(result.done).toBe(true) // generator RETURNED — no `complete` frame, source abandoned mid-flight
    expect(result.value).toBeUndefined()
})
