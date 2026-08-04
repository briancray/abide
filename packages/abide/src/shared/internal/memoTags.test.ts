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
import { until } from '../../test/internal/until.ts'
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

// A TAGGED DERIVATION (ADR 0024 §1-3). Every one of these went through the four `*ForTags` aggregates,
// which were written before `memo` absorbed derivation and never learned that a slot has two fill modes:
// they read `slot.state` and called `scheduleRefresh`, the fields and the path the AUTO mode leaves
// unused. So a tag verb ran the body on the classic loading path, wrote the result where nothing reads
// it, and left the derivation serving its old value — while `CLAUDE.md` promises a tag refresh "re-runs
// every live slot of every rpc carrying the tag" and lists `refreshing({tags})` as `fn.refreshing`'s
// analogue. The assertion each of these makes is the pair: the global verb agrees with the per-callable
// one, because they are documented as the same verb over a different selector.
describe('a tagged DERIVATION agrees with its own callable', () => {
    test('refresh({ tags }) re-runs it, so a body reading past the graph re-publishes', async () => {
        // The case `ttl`/`refresh` exist for on a derivation: the body reads something the reactive
        // graph cannot see, so nothing wakes it and an explicit revalidation is the only trigger.
        let external = 1
        const derived = memo(() => external, { tags: ['derived-ext'] })
        expect(derived()).toBe(1)

        external = 2
        expect(derived()).toBe(1) // no dependency moved — the graph is right to serve this

        refresh({ tags: ['derived-ext'] })
        await settle()
        expect(derived()).toBe(2)
    })

    test('pending({ tags }) answers what the callable answers', async () => {
        const derived = memo(() => 1, { tags: ['derived-pending'] })
        derived()
        expect(pending({ tags: ['derived-pending'] })).toBe(derived.pending())
        expect(pending({ tags: ['derived-pending'] })).toBe(false)

        // AFTER a tag refresh is where the two used to part company: the aggregate saw the classic
        // path's `pending` write on a slot whose own probe reports a synchronous fill.
        refresh({ tags: ['derived-pending'] })
        expect(pending({ tags: ['derived-pending'] })).toBe(derived.pending())
        await settle()
        expect(pending({ tags: ['derived-pending'] })).toBe(derived.pending())
    })

    test('refreshing({ tags }) reports a revalidation the refetch clock is holding back', async () => {
        let external = 1
        const derived = memo(() => external, { tags: ['derived-clock'], debounce: 40 })
        expect(derived()).toBe(1) // the first publication is never deferred

        external = 2
        refresh({ tags: ['derived-clock'] })
        expect(refreshing({ tags: ['derived-clock'] })).toBe(derived.refreshing())
        expect(refreshing({ tags: ['derived-clock'] })).toBe(true)
        expect(derived()).toBe(1) // the admitted value keeps being served during the window

        // Waited for, not slept past: the debounce window ends and the derivation then has to RUN and
        // publish, and a fixed sleep sized to the window alone raced that second half.
        await until('the debounced derivation published', () => derived() === 2)
        expect(derived()).toBe(2)
        expect(refreshing({ tags: ['derived-clock'] })).toBe(derived.refreshing())
        expect(refreshing({ tags: ['derived-clock'] })).toBe(false)
    })

    test('invalidate({ tags }) re-runs it lazily, on the next read', async () => {
        // This one already worked — `invalidateForTags` goes through `dropSlot`, which learned the
        // dichotomy. It is here so the mode's four verbs are covered as a set rather than three of four.
        let runs = 0
        const derived = memo(
            () => {
                runs++
                return runs
            },
            { tags: ['derived-invalidate'] },
        )
        expect(derived()).toBe(1)
        expect(derived()).toBe(1)

        invalidate({ tags: ['derived-invalidate'] })
        expect(derived()).toBe(2)
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
