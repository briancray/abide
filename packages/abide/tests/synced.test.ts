// 3.10 TO 3.13 — `synced`, the probe asking whether what a value holds is what its producer made. A
// write here over a value with a body takes it out of step, the producer's next production puts it
// back, and a value built from one out of step is out of step too. Gated as a WAKE as well as an
// answer: a guard on `synced` that is never told it moved reads the right thing once and then nothing.

import { expect, test } from 'bun:test'
import { flushSync, reactive, synced, watch } from '#shared'
import { produceInto } from '#shared/reactive/index.ts'

// 3.12 — NOTHING TO BE OUT OF STEP WITH: a value with no body is the producer of what it holds.
test('a value with no body is synced, whatever is written to it — 3.12', () => {
    const count = reactive(0)
    count.set(1)
    count.patch(() => {})
    expect(count.synced()).toBe(true)
})

// 3.10, 3.11 — A WRITE OVER A BODY STANDS (11.8) AND SAYS SO, until the body runs again. THE REVERT:
// drop the `writtenHere` call from `setOverProducer`; the write reads `synced` true.
test('a write over a value with a body is not synced until the body produces again — 3.10, 3.11', () => {
    const source = reactive(1)
    const doubled = reactive(() => source() * 2)
    expect(doubled()).toBe(2)
    expect(doubled.synced()).toBe(true)
    doubled.set(10)
    expect(doubled()).toBe(10)
    expect(doubled.synced()).toBe(false)
    source.set(2)
    expect(doubled()).toBe(4)
    expect(doubled.synced()).toBe(true)
})

// 3.10 — A WRITE THAT MOVED NOTHING LEAVES IT AS IT WAS: the identity gate collapsed it (5.2), so what
// is held is still what the body made. THE REVERT: drop the ordinal test from `setOverProducer`; the
// repeat reads `synced` false.
test('a write identity collapses leaves a value synced — 3.10', () => {
    const source = reactive(1)
    const doubled = reactive(() => source() * 2)
    doubled()
    doubled.set(2)
    expect(doubled.synced()).toBe(true)
})

// 3.10 — A PATCH IS A WRITE HERE TOO, and one that settles later is out of step from the moment it is
// made. THE REVERT: drop the `writtenHere` call from the `patch` member; the patch reads true.
test('a patch, and a write of a promise, over a body are not synced — 3.10', async () => {
    const list = reactive(() => [1, 2])
    list()
    list.patch((held) => {
        held.push(3)
    })
    expect(list.synced()).toBe(false)
    const later = reactive(() => 'made')
    later()
    later.set(Promise.resolve('written'))
    expect(later.synced()).toBe(false)
    expect(await later).toBe('written')
    expect(later.synced()).toBe(false)
})

// 3.11 — WHAT THE SERVER SENDS A COPY IS ITS PRODUCER'S, carried in from outside the body: the copy is
// in step again. THE REVERT: write with `set` in `produceInto`; this reads false.
test("a production carried in as the producer's puts a value back in step — 3.11", () => {
    const copy = reactive(() => ({ n: 1 }))
    copy()
    copy.set({ n: 2 })
    expect(copy.synced()).toBe(false)
    produceInto(copy, { n: 3 })
    expect(copy().n).toBe(3)
    expect(copy.synced()).toBe(true)
})

// 3.13 — A FIGURE COMPUTED FROM A VALUE WRITTEN HERE is no more the producer's than that value is.
// THE REVERT: return `true` from `walkSynced` past the value's own `local`; `total` reads true.
test('a value built from one written here is not synced — 3.13', () => {
    const list = reactive(() => [1, 2])
    const total = reactive(() => list().reduce((sum, n) => sum + n, 0))
    expect(total()).toBe(3)
    list.set([1, 2, 3])
    expect(total()).toBe(6)
    expect(total.synced()).toBe(false)
})

// 3.3 ON `synced` — A GUARD ASKING IS WOKEN BOTH WAYS, and only for the probe: the write and the
// production each wake it once. THE REVERT: drop the `probesMoved` call from `writtenHere`; the guard
// is never told it went false, and reads [true].
test('a guard reading synced is woken as it moves each way — 3.3', () => {
    const source = reactive(1)
    const doubled = reactive(() => source() * 2)
    doubled()
    const said: boolean[] = []
    const stop = watch(() => {
        said.push(doubled.synced())
    })
    doubled.set(5)
    flushSync()
    source.set(3)
    doubled()
    flushSync()
    stop()
    expect(said).toEqual([true, false, true])
})

// 13.18 — OVER A SELECTION, ALL: one entry written here is one the producer has not made.
test('synced over a keyed value is true only where every matching entry is — 13.18', () => {
    const doubled = reactive((args: { n: number }) => args.n * 2)
    doubled({ n: 1 })()
    doubled({ n: 2 })()
    expect(synced(doubled)).toBe(true)
    doubled({ n: 2 }).set(0)
    expect(synced(doubled)).toBe(false)
    expect(doubled.synced({ n: 1 })).toBe(true)
    expect(doubled.synced({ n: 2 })).toBe(false)
})
