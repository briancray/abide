// `ttl` ON A VALUE WITH NO PRODUCER (RULEBOOK 6.2, 6.11 through 6.14): a write is written back to
// the value the value was built with, `ttl` after it. Two of the claims are about a timer nobody
// can see — one left standing past its owner still lands a right-looking write somewhere nothing
// reads — so those are counted as live timers rather than read off the value.

import { expect, test } from 'bun:test'

import { spawned } from '@abide/harness/gate'

import { reactive } from '#shared'
import { collectWatches } from '#shared/reactive/watch.ts'

/** Runs `build` as a component's setup is run, and answers what ends it. */
function inSetup(build: () => void): () => void {
    const stops: (() => void)[] = []
    const previous = collectWatches(stops)
    build()
    collectWatches(previous)
    return () => {
        for (const stop of stops) stop()
    }
}

/** Counts the timers `during` leaves standing: armed, and neither fired nor cleared. */
function liveTimers(during: () => void): () => number {
    const live = new Set<unknown>()
    const realSet = globalThis.setTimeout
    const realClear = globalThis.clearTimeout
    globalThis.setTimeout = ((run: () => void, delay?: number) => {
        const timer = realSet(() => {
            live.delete(timer)
            run()
        }, delay)
        live.add(timer)
        return timer
    }) as typeof setTimeout
    globalThis.clearTimeout = ((timer: ReturnType<typeof setTimeout>) => {
        live.delete(timer)
        realClear(timer)
    }) as typeof clearTimeout
    try {
        during()
    } finally {
        globalThis.setTimeout = realSet
        globalThis.clearTimeout = realClear
    }
    return () => live.size
}

// 6.2: A WRITE IS WRITTEN BACK `ttl` AFTER IT. The `copied` flag a copy button shows for two seconds,
// with no `setTimeout` of the app's own.
//
// THE REVERT: seat the value on `seatOf(cell)` rather than `REWIND_PROTOTYPE` in `createReactive`,
// and `after the ttl: true` where `false` is due.
test('a write to a value with no producer is written back to its opening value after the ttl — 6.2', async () => {
    const copied = reactive(false, { ttl: 30 })
    copied.set(true)
    expect(`at once: ${copied()}`).toBe('at once: true')
    await Bun.sleep(60)
    expect(`after the ttl: ${copied()}`).toBe('after the ttl: false')
})

// 6.11: A LATER WRITE RESTARTS THE CLOCK, a repeated `true` included — a second copy keeps the flag
// up for another full `ttl`, though 5.2 mints nothing for it.
//
// THE REVERT: return early from `rewindLater` where a timer is already standing, and
// `after the second write's ttl less a beat: false` where `true` is due.
test('a later write restarts the clock, a repeat of the held value included — 6.11', async () => {
    const copied = reactive(false, { ttl: 60 })
    copied.set(true)
    await Bun.sleep(40)
    copied.set(true)
    await Bun.sleep(40)
    expect(`after the second write's ttl less a beat: ${copied()}`).toBe(
        "after the second write's ttl less a beat: true",
    )
    await Bun.sleep(50)
    expect(`after the second write's ttl: ${copied()}`).toBe(
        "after the second write's ttl: false",
    )
})

// 6.12: A WRITE OF THE OPENING VALUE STANDS THE CLOCK DOWN — by the value's `identity`, so a
// structural one counts an equal copy as the opening value.
//
// THE REVERT: drop the identity arm from `rewindLater`, and `live timers: 2` where `0` is due.
test('a write of the opening value leaves no timer standing — 6.12', () => {
    const byStage = (
        next: { stage: string },
        previous: { stage: string },
    ): boolean => next.stage === previous.stage
    let copied = reactive(false)
    let filter = reactive({ stage: 'all' })
    const live = liveTimers(() => {
        copied = reactive(false, { ttl: 1_000 })
        copied.set(true)
        copied.set(false)
        filter = reactive({ stage: 'all' }, { ttl: 1_000, identity: byStage })
        filter.set({ stage: 'won' })
        filter.set({ stage: 'all' })
    })
    expect(`live timers: ${live()}`).toBe('live timers: 0')
    expect(copied()).toBe(false)
    expect(filter().stage).toBe('all')
})

// 6.13: A REFUSED WRITE MOVES NO CLOCK. It left the value where it was (4.9), so a clock it armed
// would write back a value nobody wrote.
//
// THE REVERT: arm in `REWIND_PROTOTYPE.set` whatever `set` answered, and `live timers: 1` where `0`
// is due.
test('a write a gate refuses arms no timer — 6.13', () => {
    let amount = reactive<number, number>(0, { ttl: 1_000 })
    const live = liveTimers(() => {
        amount = reactive<number, number>(0, {
            ttl: 1_000,
            schema: (value: unknown) => {
                if (typeof value !== 'number' || value < 0)
                    throw new Error('must not be negative')
                return value
            },
        })
        amount.set(-5)
    })
    expect(`live timers: ${live()}`).toBe('live timers: 0')
    expect(amount()).toBe(0)
})

// 6.14: THE TIMER STOPS WITH THE OWNER THAT BUILT THE VALUE, and a write after that arms none. A
// copy button clicked in a dialog that then closed left a timer writing into a component that was
// gone — which every hand-written `setTimeout(() => copied = false)` does.
//
// THE REVERT: drop the `owned(...)` from `rewindOnTtl`, and `live timers after the owner ended: 1`
// where `0` is due.
test('the timer stops with the owner that built the value, and a later write arms none — 6.14', async () => {
    let copied = reactive(false)
    let end = (): void => {}
    const live = liveTimers(() => {
        end = inSetup(() => {
            copied = reactive(false, { ttl: 30 })
        })
        copied.set(true)
        end()
        copied.set(true)
    })
    expect(`live timers after the owner ended: ${live()}`).toBe(
        'live timers after the owner ended: 0',
    )
    await Bun.sleep(60)
    expect(`after the ttl: ${copied()}`).toBe('after the ttl: true')
})

// 6.15: THE WRITE BACK IS A COPY OF THE OPENING VALUE AS IT WAS BUILT. A `patch` changes the held
// object in place, and the held object is the opening one until something else is written — so a
// write back of that reference would restore the patch it was meant to undo.
//
// THE REVERT: write `rewind.initial` back in `rewindLater`'s timer instead of a clone of
// `rewind.snapshot`, and `after the ttl: investor,speaker` where `investor` is due; write
// `rewind.snapshot` itself, uncloned, and `after the second ttl: investor,mentor`.
test('the write back is a copy of the opening value as built, whatever a patch did to it — 6.15', async () => {
    const tags = reactive(['investor'], { ttl: 30 })
    tags.patch((held) => {
        held.push('speaker')
    })
    await Bun.sleep(60)
    expect(`after the ttl: ${tags().join()}`).toBe('after the ttl: investor')
    // A fresh copy each time, so patching the first write back cannot reach the second.
    tags.patch((held) => {
        held.push('mentor')
    })
    await Bun.sleep(60)
    expect(`after the second ttl: ${tags().join()}`).toBe(
        'after the second ttl: investor',
    )
})

// 6.16: AN OPENING VALUE NO COPY CAN STAND FOR IS REFUSED WHERE IT IS BUILT, rather than written
// back as something else — a class instance copied as a plain object loses its methods silently.
//
// THE REVERT: drop the prototype comparison from `openingSnapshot`, and the `Draft` instance is
// built where a throw is due — `Received function did not throw`.
test('an opening value structuredClone cannot copy whole is refused at construction — 6.16', () => {
    class Draft {
        text = ''
        empty(): boolean {
            return this.text === ''
        }
    }
    const refusal = 'structuredClone cannot copy whole'
    expect(() => reactive(new Draft(), { ttl: 1_000 })).toThrow(refusal)
    expect(() => reactive({ run: () => 1 }, { ttl: 1_000 })).toThrow(refusal)
    // Plain data, a primitive and a built-in structuredClone keeps are all taken.
    reactive({ stage: 'won' }, { ttl: 1_000 })
    reactive(0, { ttl: 1_000 })
    reactive(new Date(0), { ttl: 1_000 })
    // A value with a producer writes nothing back, so it has nothing to copy.
    reactive(() => new Draft(), { ttl: 1_000 })
})

// 6.4: A VALUE WRITTEN AND NEVER ENDED DOES NOT KEEP THE PROCESS ALIVE — a module's flag, set by the
// last thing a script does.
//
// THE REVERT: drop the `unrefTimer` from `armTimer`, and the child never exits — `did not finish in
// 5000 ms`.
test('a timer 6.2 armed does not hold the process open — 6.4', async () => {
    const source = `import { reactive } from '${import.meta.dir}/../src/shared/index.ts'
const copied = reactive(false, { ttl: 60_000 })
copied.set(true)`
    const ran = await spawned(['bun', '-e', source], { deadline: 5_000 })
    expect(`exit: ${ran.exitCode}`, ran.stderr).toBe('exit: 0')
}, 10_000)
