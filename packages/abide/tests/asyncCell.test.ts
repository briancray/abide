import { describe, expect, test } from 'bun:test'
import { isAsyncCell } from '../src/lib/shared/isAsyncCell.ts'
import { peek } from '../src/lib/shared/peek.ts'
import { pending } from '../src/lib/shared/pending.ts'
import { refresh } from '../src/lib/shared/refresh.ts'
import { refreshing } from '../src/lib/shared/refreshing.ts'
import type { AsyncComputed } from '../src/lib/shared/types/AsyncComputed.ts'
import type { AsyncState } from '../src/lib/shared/types/AsyncState.ts'
import type { NamedAsyncIterable } from '../src/lib/shared/types/NamedAsyncIterable.ts'
import { computed } from '../src/lib/ui/computed.ts'
import { linked } from '../src/lib/ui/linked.ts'
import { createAsyncCell } from '../src/lib/ui/runtime/createAsyncCell.ts'
import { state } from '../src/lib/ui/state.ts'
import { trackedComputed } from '../src/lib/ui/trackedComputed.ts'
import { settle } from './support/settle.ts'

/* A hand-driven NamedAsyncIterable — the stream-source shape (async-iterable + a stable
   name). `push` delivers a frame to the live iterator; `fail` throws; `close` ends it. */
function makeStream<T>(name: string): NamedAsyncIterable<T> & {
    push(frame: T): void
    fail(error: unknown): void
    close(): void
} {
    let resolveNext: ((step: IteratorResult<T>) => void) | undefined
    let rejectNext: ((error: unknown) => void) | undefined
    const queue: T[] = []
    let ended = false
    let failure: unknown
    const iterator: AsyncIterator<T> = {
        next(): Promise<IteratorResult<T>> {
            if (queue.length > 0) {
                return Promise.resolve({ value: queue.shift() as T, done: false })
            }
            if (failure !== undefined) {
                return Promise.reject(failure)
            }
            if (ended) {
                return Promise.resolve({ value: undefined as never, done: true })
            }
            return new Promise((resolve, reject) => {
                resolveNext = resolve
                rejectNext = reject
            })
        },
        return(): Promise<IteratorResult<T>> {
            ended = true
            return Promise.resolve({ value: undefined as never, done: true })
        },
    }
    return {
        name,
        [Symbol.asyncIterator]: () => iterator,
        push(frame: T): void {
            if (resolveNext !== undefined) {
                const settle = resolveNext
                resolveNext = undefined
                settle({ value: frame, done: false })
            } else {
                queue.push(frame)
            }
        },
        fail(error: unknown): void {
            if (rejectNext !== undefined) {
                const reject = rejectNext
                rejectNext = undefined
                reject(error)
            } else {
                failure = error
            }
        },
        close(): void {
            if (resolveNext !== undefined) {
                const settle = resolveNext
                resolveNext = undefined
                settle({ value: undefined as never, done: true })
            } else {
                ended = true
            }
        },
    }
}

describe('async cell — promise seed (computed(await …))', () => {
    test('pending → resolved, peek returns the value', async () => {
        const cell = computed(async () => 42) as AsyncComputed<number>
        expect(isAsyncCell(cell)).toBe(true)
        expect(cell.pending()).toBe(true)
        expect(cell.peek()).toBeUndefined()

        await settle()
        expect(cell.pending()).toBe(false)
        expect(cell.peek()).toBe(42)
        expect(cell.error()).toBeUndefined()
    })

    test('rejection lands in error(), never throws, keeps no value', async () => {
        const boom = new Error('boom')
        const cell = computed(async () => {
            throw boom
        }) as AsyncComputed<number>

        await settle()
        expect(cell.error()).toBe(boom)
        expect(cell.peek()).toBeUndefined()
        expect(cell.pending()).toBe(false)
    })

    test('refresh() re-invokes the seed keeping the value visible (SWR)', async () => {
        let n = 0
        const cell = computed(async () => (n += 1)) as AsyncComputed<number>
        await settle()
        expect(cell.peek()).toBe(1)

        cell.refresh()
        expect(cell.refreshing()).toBe(true)
        expect(cell.pending()).toBe(false)
        expect(cell.peek()).toBe(1) // stale value stays visible during the refresh

        await settle()
        expect(cell.peek()).toBe(2)
        expect(cell.refreshing()).toBe(false)
    })

    test('a failed refresh retains the stale value (SWR)', async () => {
        let fail = false
        const cell = computed(async () => {
            if (fail) {
                throw new Error('later')
            }
            return 'ok'
        }) as AsyncComputed<string>
        await settle()
        expect(cell.peek()).toBe('ok')

        fail = true
        cell.refresh()
        await settle()
        expect(cell.peek()).toBe('ok') // stale value held
        expect((cell.error() as Error).message).toBe('later')
    })
})

describe('async cell — standalone probes route to the cell', () => {
    test('peek/pending/refreshing/refresh delegate to the facet', async () => {
        let n = 0
        const cell = computed(async () => (n += 1)) as AsyncComputed<number>
        expect(pending(cell)).toBe(true)

        await settle()
        expect(peek(cell)).toBe(1)
        expect(pending(cell)).toBe(false)

        refresh(cell)
        expect(refreshing(cell)).toBe(true)
        await settle()
        expect(peek(cell)).toBe(2)
    })
})

describe('async cell — stream seed (auto-track a NamedAsyncIterable)', () => {
    test('auto-tracks frames; pending until the first frame', async () => {
        const stream = makeStream<number>('counter')
        const cell = createAsyncCell(() => stream, { writable: false }) as AsyncComputed<number>
        expect(isAsyncCell(cell)).toBe(true)
        expect(cell.pending()).toBe(true)

        stream.push(1)
        await settle()
        expect(cell.peek()).toBe(1)
        expect(cell.pending()).toBe(false)

        stream.push(2)
        await settle()
        expect(cell.peek()).toBe(2)
    })

    test('a stream error surfaces on error() and keeps the last frame', async () => {
        const stream = makeStream<number>('flaky')
        const cell = createAsyncCell(() => stream, { writable: false }) as AsyncComputed<number>
        stream.push(7)
        await settle()
        expect(cell.peek()).toBe(7)

        const boom = new Error('stream boom')
        stream.fail(boom)
        await settle()
        expect(cell.error()).toBe(boom)
        expect(cell.peek()).toBe(7) // last frame retained
    })
})

describe('writable async cell — linked(await …) / linked(getStream())', () => {
    test('set() latches until reseed; a frame never clobbers the write', async () => {
        const stream = makeStream<string>('draft')
        const cell = linked(() => stream) as AsyncState<string>
        stream.push('server-a')
        await settle()
        expect(cell.peek()).toBe('server-a')

        cell.set('my-edit')
        expect(cell.peek()).toBe('my-edit')

        stream.push('server-b') // frame arrives into the background, must not clobber the edit
        await settle()
        expect(cell.peek()).toBe('my-edit')
    })

    test('a reseed (dependency change) clears the write and snaps live', async () => {
        const first = makeStream<string>('s1')
        const second = makeStream<string>('s2')
        const which = state(first)
        // The seed reads `which` synchronously, so changing it re-runs the effect → reseed.
        const cell = linked(() => which.value) as AsyncState<string>

        first.push('one')
        await settle()
        expect(cell.peek()).toBe('one')

        cell.set('edited')
        expect(cell.peek()).toBe('edited')

        which.value = second // reseed: new source, write cleared
        second.push('two')
        await settle()
        expect(cell.peek()).toBe('two')
    })
})

describe('trackedComputed — the eager read-only stream-classifying entry', () => {
    test('a stream seed auto-tracks frames as a read-only AsyncComputed', async () => {
        const stream = makeStream<number>('tracked')
        const cell = trackedComputed(() => stream) as AsyncComputed<number>
        expect(isAsyncCell(cell)).toBe(true)
        expect(cell.pending()).toBe(true)

        stream.push(5)
        await settle()
        expect(cell.peek()).toBe(5)
    })

    test('an await seed unwraps its promise', async () => {
        const cell = trackedComputed(async () => 9) as AsyncComputed<number>
        expect(isAsyncCell(cell)).toBe(true)
        await settle()
        expect(cell.peek()).toBe(9)
    })

    test('a plain-value seed falls back to a lazy sync Computed (no cell)', () => {
        const cell = trackedComputed(() => 3) as { value: number }
        expect(isAsyncCell(cell)).toBe(false)
        expect(cell.value).toBe(3)
    })
})

describe('async cell — nameless async iterable auto-tracks (isAsyncIterable)', () => {
    /* A plain async generator (an AsyncGenerator has no `name`) — the case `isSubscribable`
       rejected and the broader `isAsyncIterable` classify now accepts. The eager stream-
       classifying entries are `trackedComputed` (what the compiler routes `computed(getStream())`
       to) and `linked`; the lazy `computed` primitive never probes, so it is not exercised here. */
    async function* plainAsyncGen(): AsyncGenerator<number> {
        yield 1
        yield 2
    }

    test('trackedComputed(() => plainAsyncGen()) auto-tracks its latest frame (read-only)', async () => {
        const cell = trackedComputed(() => plainAsyncGen()) as unknown as AsyncComputed<number>
        expect(isAsyncCell(cell)).toBe(true)
        await settle()
        expect(cell.peek()).toBe(2)
    })

    test('linked(() => plainAsyncGen()) auto-tracks its latest frame (writable)', async () => {
        const cell = linked(() => plainAsyncGen()) as unknown as AsyncState<number>
        expect(isAsyncCell(cell)).toBe(true)
        await settle()
        expect(cell.peek()).toBe(2)
    })

    test('regression: a named makeStream iterable still auto-tracks', async () => {
        const stream = makeStream<number>('named')
        const cell = trackedComputed(() => stream) as unknown as AsyncComputed<number>
        expect(isAsyncCell(cell)).toBe(true)
        stream.push(9)
        await settle()
        expect(cell.peek()).toBe(9)
    })
})
