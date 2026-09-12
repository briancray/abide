// EVERY ONE OF THESE IS A "DOES LESS WORK" CONTRACT, so a correctness test cannot
// guard it: the wrong implementation still produces the right output. What is
// asserted is the WAKE-UPS — a reader that woke when nothing it reads changed still
// reads the right value.
//
// NONE OF THEM CAN BE A `gate()` CALL, and that is a finding rather than an omission.
// `gate(name, { revert, worth }, body)` takes a function INSTALLING the broken arm,
// and every mechanism below is a module-level function or a field fixed at
// construction; swapping one behind a flag with a single live value is the machinery
// this repo deletes. So each carries the revert to HAND-APPLY and the number it
// reports with the mechanism out, which is the case CLAUDE.md carves out for exactly
// this shape.
//
// The counts come back through `settled()` rather than off a local, so the
// `__ABIDE_WORK__` wire (44.25, D113) is exercised by the tests that depend on it
// instead of being asserted about in two documents and run by nobody.

import { expect, test } from 'bun:test'
import { armCase, disarmCase, measure, type Work } from 'harness/measure'
import { memo, state, watch } from '#shared/index.ts'
import { publishWork } from '#shared/reactive/counters.ts'
import { flushEffects } from '#shared/reactive/graph.ts'

// 12.12 — A WRITE SCHEDULES ITS READERS RATHER THAN RUNNING THEM, so the op every case
// here measures is the write plus the tick that delivers it. `measure()` takes a
// synchronous body and this lane may not import abide to drain the queue itself (44.1),
// so the drain is spelled once here and every case reaches for it. Written as the op
// rather than as two lines per case: a case that forgot the drain would report zero
// wakes and pass every "does less work" assertion vacuously.
const measureSettled = (body: () => void): Work =>
    measure(() => {
        body()
        flushEffects()
    })


publishWork()

// REVERT: one subscriber list per node instead of a mask per edge — drop the
// `link.mask & changed` test in `notifySubscribers`. REPORTS: 1 wake where this
// asserts 0, and every probe reader in a page re-runs on every keystroke.
test('a reader of s.pending() alone does not wake on a value change', () => {
    const s = state(1)
    watch(() => {
        s.pending()
    })
    const work = measureSettled(() => s.set(2))
    expect(work.wakes).toBe(0)
})

// The positive half of the row above, and it needs its own test because the
// transition is asynchronous: `settled()` takes a synchronous body, so the case is
// armed and disarmed around the settle instead. Without this, the assertion above
// passes just as well against a reader subscribed to nothing at all.
test('a reader of s.pending() alone does wake when the load settles', async () => {
    let settle: ((value: number) => void) | undefined
    const loading = state(
        new Promise<number>((resolve) => {
            settle = resolve
        }),
    )
    watch(() => {
        loading.pending()
    })
    expect(loading.pending()).toBe(true)
    armCase()
    settle?.(3)
    await new Promise((resolve) => setTimeout(resolve, 0))
    const work = disarmCase()
    expect(work.wakes).toBe(1)
    expect(loading.pending()).toBe(false)
})

// REVERT: `link.mask |= mask` in `claim` — widen across runs rather than replacing on
// the run's first touch. REPORTS: 1 wake per subsequent write where this asserts 0.
// The ratchet is one-way and invisible to a correctness test: the reader keeps
// rendering the right thing and wakes on a channel it stopped reading.
test('a reader whose read set shrinks stops waking on what it dropped', () => {
    const s = state(1)
    const readValue = state(true)
    watch(() => {
        if (readValue()) s()
        else s.pending()
    })
    readValue.set(false)
    flushEffects()
    const work = measureSettled(() => s.set(2))
    expect(work.wakes).toBe(0)
})

// REVERT: sweep everything after `reader.cursor` rather than every link whose
// `claimed` is not this run. REPORTS: 1 wake where this asserts 0 — a source dropped
// from IN FRONT of the cursor sits behind it at end of run and is never unlinked, so
// the reader goes on waking on a value it no longer reads. The output stays right,
// which is the whole reason this is a count and not an assertion on what it rendered.
test('a reader that stops reading a source stops waking on it', () => {
    const flag = state(true)
    const first = state(1)
    const second = state(1)
    const seen: number[] = []
    watch(() => {
        if (flag()) first()
        seen.push(second() as number)
    })
    flag.set(false)
    flushEffects()
    const work = measureSettled(() => first.set(2))
    expect(work.wakes).toBe(0)
    // The positive half: the source it KEPT still wakes it. Zero wakes also passes
    // against a reader that unsubscribed from everything.
    const kept = measureSettled(() => second.set(2))
    expect(kept.wakes).toBe(1)
})

// The same sweep, from the other end: a node read TWICE with another between the two
// reads is claimed at its old position by `attach`'s second arm, which does not move
// the cursor — so `b` is behind the cursor at end of run and a sweep that trusted the
// cursor's position rather than each link's `claimed` would drop it.
test('a reader reading a, b, a still wakes on b', () => {
    const a = state(1)
    const b = state(1)
    watch(() => {
        a()
        b()
        a()
    })
    const work = measureSettled(() => b.set(2))
    expect(work.wakes).toBe(1)
})

// REVERT: drop `attach`'s second arm, the one that widens a mask in place behind the
// cursor. REPORTS: 1 channel where this asserts 2 — the reader either stops waking on
// the probe or stops re-rendering on the value, depending on which it read first.
//
// Not a corner case: it is D69's own mechanism. `propagated` subscribes the asking
// reader to a probed memo's sources, so `{#if items.pending()}{rows()}` touches
// `rows` twice in one run.
test('a reader touching one node twice holds one edge carrying both masks', () => {
    const s = state(1)
    const built = measureSettled(() => {
        watch(() => {
            s.refreshing()
            s()
        })
    })
    // ONE `Link`, not two. Dropping the second arm is not a correctness failure here
    // — the reader ends up with two edges on the same node, one per channel, and both
    // still wake — it is a second edge allocated on every node a reader touches twice
    // and carried for that reader's whole life. So the count is where it shows, and
    // the two wake assertions below are what stop the count passing vacuously.
    expect(built.links).toBe(1)
    const onValue = measureSettled(() => s.set(2))
    expect(onValue.wakes).toBe(1)
    // 3.14 — a load over a landed value that is not stale reports `s.refreshing`. The
    // second channel, on the same edge, in the same run.
    const onProbe = measureSettled(() => s.set(Promise.resolve(3)))
    expect(onProbe.wakes).toBe(1)
})

// REVERT: resolve a CHECK reader against `node.version` alone — drop `seenPulse`, the
// second arm of `stale`, and the pulse bump in `recompute`. REPORTS: 0 body runs where
// this asserts 1, and the spinner never appears.
//
// THE CASE IS THE ONE THAT DISTINGUISHES, which a memo starting its own load is not:
// that transition fires a direct wake on the reader's own channel and lands DIRTY
// whichever token is consulted. Here the memo's recompute moves neither its value nor
// its own status — it reaches a DIFFERENT source, one that is loading — so the reader
// of `m.pending()` is at CHECK with nothing under it having moved except the source
// set a propagated probe is derived from.
test('a probe reader re-runs when a memo reaches a new pending source', () => {
    const which = state(true)
    const settled = state(1)
    const loading = state(new Promise<number>(() => {}))
    const picked = memo(() => (which() ? settled() : loading()))
    let runs = 0
    let sawPending = false
    watch(() => {
        runs += 1
        sawPending = picked.pending()
    })
    // 11.61 — the first run reports pending before the body has run at all. Reading
    // the value is what runs it.
    expect(sawPending).toBe(true)
    picked()
    flushEffects()
    expect(sawPending).toBe(false)
    const before = runs
    which.set(false)
    flushEffects()
    expect(runs - before).toBe(1)
    expect(sawPending).toBe(true)
})

// REVERT: drop the forced `| ERRORED` from `fail` and from `refuse`. REPORTS: 0 wakes
// where this asserts 1 — `enter` reports a TRANSITION, and a second rejection is
// ERRORED set → set, whose XOR is zero. The reader keeps rendering the first error
// while the second sits in `s.error`.
test('a second consecutive rejection wakes a reader of s.error', async () => {
    const s = state<number>(1, {
        transform: (value) =>
            value > 1
                ? (Object.assign(new Error('too big'), {
                      name: 'TooBig',
                      status: 400,
                      data: value,
                  }) as never)
                : value,
    })
    const seen: unknown[] = []
    watch(() => {
        seen.push((s.error() as { data?: unknown })?.data)
    })
    s.set(2)
    flushEffects()
    const work = measureSettled(() => s.set(3))
    expect(work.wakes).toBe(1)
    expect(seen.at(-1)).toBe(3)
})

// REVERT: route `patch` through `produce`'s duplicate gate. REPORTS: 0 wakes on a
// 500-row reverse where this asserts 1 — `s.patch` mutates IN PLACE, so `incoming` is
// `this.value`, already mutated, and 5.4's structural default answers "equal" for
// every patch there has ever been.
test('s.patch wakes its readers on a 500-row reverse', () => {
    const rows = state(Array.from({ length: 500 }, (_, at) => at))
    watch(() => {
        rows()
    })
    const work = measureSettled(() =>
        rows.patch((held) => {
            ;(held as number[]).reverse()
        }),
    )
    expect(work.wakes).toBe(1)
    expect((rows() as number[])[0]).toBe(499)
})

// REVERT: push eagerly from `produce` instead of notifying CHECK and pulling at
// `flushEffects`. REPORTS: every downstream effect re-runs where this asserts 0 —
// 5.2's failure mode is the right value on screen and the whole subtree rebuilt.
test('a memo recompute yielding an equal identity wakes zero effects', () => {
    const source = state({ id: 1, seen: 0 })
    const projected = memo(() => ({ id: (source() as { id: number }).id }))
    watch(() => {
        projected()
    })
    const work = measureSettled(() => source.set({ id: 1, seen: 2 }))
    expect(work.wakes).toBe(0)
    // The positive half: a recompute that DOES change identity wakes exactly once.
    const changed = measureSettled(() => source.set({ id: 2, seen: 2 }))
    expect(changed.wakes).toBe(1)
})

// REVERT: wake on eviction as well as on production. REPORTS: 1 wake per expiry where
// this asserts 0 — 6.4 makes an expiry invisible to a reader, and a ring that wakes
// on one turns a `ttl` into a timer-driven re-render of every page holding the value.
test('a ttl expiry on a ring wakes no reader', async () => {
    const s = state(1, { tail: 4, ttl: 5 })
    s.set(2)
    watch(() => {
        s()
    })
    const work = measureSettled(() => {})
    expect(work.wakes).toBe(0)
    await new Promise((resolve) => setTimeout(resolve, 20))
    const afterExpiry = measureSettled(() => {
        // 6.5 — dropped on the read that follows, which is what makes the answer
        // right even where the timer has not fired.
        ;[...s.tail()]
        // AND THE QUEUE IS DRAINED INSIDE THE MEASURED BODY. Without this the gate
        // does not distinguish: a ring that woke on eviction would ENQUEUE the reader
        // here and nothing in the read path flushes, so the count came back 0 with
        // the broken arm installed and the gate was worth nothing. Verified by
        // running it.
        flushEffects()
    })
    expect(afterExpiry.wakes).toBe(0)
    expect([...s.tail()]).toEqual([])
    // The positive half: the value is still served. 6.5 drops the RETENTION, not the
    // value, and an assertion on the empty ring alone passes against a ring that was
    // never written to.
    expect(s()).toBe(2)
})

// REVERT: recompute unconditionally in `bringUpToDate` — `reader.evaluate()` wherever
// the memo's reader is not CLEAN. REPORTS: 2 body runs where this asserts 1.
//
// A memo over a memo is notified at CHECK rather than at DIRTY, and recomputing on
// CHECK is the eager push wearing a different hat: the INNER recompute may have
// yielded an equal identity, in which case nothing the outer body reads has moved.
test('a memo over a memo does not recompute when the inner identity holds', () => {
    const source = state({ id: 1, seen: 0 })
    const inner = memo(() => ({ id: (source() as { id: number }).id }))
    let outerRuns = 0
    const outer = memo(() => {
        outerRuns += 1
        return (inner() as { id: number }).id * 2
    })
    expect(outer()).toBe(2)
    expect(outerRuns).toBe(1)
    source.set({ id: 1, seen: 2 })
    expect(outer()).toBe(2)
    expect(outerRuns).toBe(1)
    // The positive half: a change the inner identity DOES see reaches the outer body.
    source.set({ id: 3, seen: 2 })
    expect(outer()).toBe(6)
    expect(outerRuns).toBe(2)
})
