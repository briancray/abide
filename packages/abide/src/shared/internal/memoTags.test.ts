// The TAG registry, exercised through the SHARED surface only — a `memo({ tags })` plus the four
// global selectors, with no RPC and no request scope anywhere.
//
// `memoTags.ts` moved to `shared/internal/` in ADR 0026 A1, but its only test stayed in
// `server/internal/` — and that test reaches for `makeRead` and `runInScope`, i.e. it covers tags AS
// USED BY AN RPC. That is a legitimate server-lane integration test and it belongs where it is;
// relocating it would only drag server machinery into `shared/`. What was actually missing is this: a
// test that the primitive works on its own terms. Tags stopped requiring `crossRequest` (they are
// isomorphic now), so "a tagged memo with no transport, no scope, no RPC" is the base case, and it had
// no coverage at all.

import { afterEach, describe, expect, test } from 'bun:test'
import { invalidate } from '../invalidate.ts'
import { memo } from '../memo.ts'
import { pending } from '../pending.ts'
import { refresh } from '../refresh.ts'
import { refreshing } from '../refreshing.ts'
import { clearTagRegistry, taggedMemoCount } from './memoTags.ts'

// The registry is a module global. Every test names its own tags AND clears, because a leaked
// registration makes the next test's `taggedMemoCount` lie.
afterEach(() => {
    clearTagRegistry()
})

async function settle(): Promise<void> {
    await Promise.resolve()
    await Promise.resolve()
}

describe('registration', () => {
    test('a tagged memo registers under EVERY tag it names', () => {
        memo(async () => 1, { tags: ['alpha', 'beta'] })
        expect(taggedMemoCount('alpha')).toBe(1)
        expect(taggedMemoCount('beta')).toBe(1)
    })

    test('an untagged memo registers nowhere', () => {
        memo(async () => 1)
        expect(taggedMemoCount('alpha')).toBe(0)
    })

    test('two memos on one tag both register', () => {
        memo(async () => 1, { tags: ['shared-tag'] })
        memo(async () => 2, { tags: ['shared-tag'] })
        expect(taggedMemoCount('shared-tag')).toBe(2)
    })
})

describe('invalidate({ tags })', () => {
    test('drops the slot, so the next read runs the body again', async () => {
        let runs = 0
        const load = memo(
            async () => {
                runs++
                return runs
            },
            { tags: ['bust'] },
        )
        expect(await load()).toBe(1)
        expect(await load()).toBe(1) // retained

        invalidate({ tags: ['bust'] })
        expect(await load()).toBe(2)
    })

    test('reaches only the memos carrying a listed tag', async () => {
        let taggedRuns = 0
        let otherRuns = 0
        const tagged = memo(
            async () => {
                taggedRuns++
                return taggedRuns
            },
            { tags: ['only-me'] },
        )
        const other = memo(
            async () => {
                otherRuns++
                return otherRuns
            },
            { tags: ['not-me'] },
        )
        await tagged()
        await other()

        invalidate({ tags: ['only-me'] })
        await tagged()
        await other()
        expect(taggedRuns).toBe(2)
        expect(otherRuns).toBe(1)
    })

    test('an unknown tag is a no-op, not an error', () => {
        expect(() => invalidate({ tags: ['nobody-has-this'] })).not.toThrow()
    })
})

describe('refresh({ tags })', () => {
    // EAGER: unlike `invalidate`, it re-runs without waiting for a read.
    test('re-runs the body without a read', async () => {
        let runs = 0
        const load = memo(
            async () => {
                runs++
                return runs
            },
            { tags: ['eager'] },
        )
        await load()
        expect(runs).toBe(1)

        refresh({ tags: ['eager'] })
        await settle()
        expect(runs).toBeGreaterThan(1)
    })
})

describe('pending / refreshing ({ tags })', () => {
    test('pending is true while a first load is in flight, false once settled', async () => {
        let release: (value: number) => void = () => {}
        const load = memo(
            () =>
                new Promise<number>((resolve) => {
                    release = resolve
                }),
            { tags: ['inflight'] },
        )
        const reading = load()
        await settle()
        expect(pending({ tags: ['inflight'] })).toBe(true)

        release(1)
        await reading
        await settle()
        expect(pending({ tags: ['inflight'] })).toBe(false)
    })

    test('both are false for a tag nothing carries', () => {
        expect(pending({ tags: ['empty'] })).toBe(false)
        expect(refreshing({ tags: ['empty'] })).toBe(false)
    })
})
