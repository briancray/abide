// The test kit — one shape for a demonstration, a test and a bench.
//
// A demo that is only a demo rots: it renders something plausible and nobody notices when the
// plausible thing is wrong. A test that is only a test documents nothing. So there is ONE shape
// here, a `Case`, with three optional faces:
//
//   run       the headless body. Assertions live here, and it runs BOTH under `bun test` and inside
//             the browser card — the same code, so the two can never drift.
//   interact  browser only: buttons, inputs, a live area to poke. Never runs headless, because a
//             claim that needs a click is a claim no test can make.
//   bench     measurement arms. Reported in the browser as ratios; smoke-run headless, so an arm
//             that no longer compiles or throws is caught by `bun test` even though its NUMBERS
//             mean nothing outside a real engine.
//
// Assertions are not `bun:test`'s `expect`, because the same assertion has to run where there is no
// test runner. `ctx.is(...)` records a line and throws an `AssertionError` on mismatch: the runner
// turns that into a failed test, the card paints it red.

import { isThenable } from '$shared/internal/probes.ts'
import { watch } from '$shared/reactive.ts'
import { AssertionError, equals, fail, messageMatches, show } from './internal/assert.ts'
import type { Arm } from './internal/bench.ts'

export { AssertionError, equals, show } from './internal/assert.ts'
export {
    type Arm,
    clockResolution,
    duration,
    FLOOR,
    floorTicks,
    frame,
    microtasks,
    NOISE,
    NOISY_SPREAD,
    quiesce,
    ratioText,
    settled,
    type Timing,
    timeArms,
    verdict,
} from './internal/bench.ts'
export {
    type Counts,
    install,
    measure,
    measureFlush,
    nodesMade,
    nonZero,
    tick,
    total,
} from './internal/dom.ts'
export { type Loopback, loopback } from './internal/loopback.ts'

// --- what a case says -------------------------------------------------------

export type LineKind = 'note' | 'pass' | 'fail'

export interface LogLine {
    label: string
    value: string
    kind: LineKind
}

export interface Log {
    /** One labelled line. The value is stringified the way a console would show it. */
    (label: string, value?: unknown): void
    /** A line that REPLACES the last one with the same label — for counters that tick. */
    live(label: string, value: unknown): void
}

export interface Ctx {
    /** The live area. A detached element headless; the card's body in the browser. */
    host: HTMLElement
    log: Log
    /** Assert structural equality. Records the line either way; throws on a mismatch. */
    is<T>(label: string, actual: T, expected: T): void
    /** Assert the call throws, optionally matching the message as a substring or a pattern. */
    throws(label: string, fn: () => unknown, match?: string | RegExp): void
    /** Assert the promise rejects, optionally matching the message. */
    rejects(label: string, value: PromiseLike<unknown>, match?: string | RegExp): Promise<void>
}

// A bench makes one of four kinds of claim, because a framework makes four kinds of claim. None of
// them carries its own prose: the CASE's `note` is the claim, so the page and the test cannot drift
// into describing two different things.
export type Bench = TimeBench | WorkBench | WakeBench | BudgetBench

/** How long an operation takes, as a RATIO against a hand-written arm in the same substrate. */
export interface TimeBench {
    kind: 'time'
    /** Divide the per-op time by this many items, for a per-row number. */
    per?: { n: number; label: string }
    /**
     * These arms drain the microtask queue to include the effect flush, so the card shows the two
     * awaits that costs as its own row. Without it a 430 ns harness sits inside every number and the
     * ratio against a synchronous hand-written arm is roughly twice what the code deserves.
     */
    floor?: 'flush'
    /** The FIRST arm is always abide; the ratio column is abide ÷ arm. */
    arms: Arm[]
}

/**
 * How much DOM work it does. Counted, never timed — the wrong implementation produces the right
 * output at full cost, and only a counter can tell them apart.
 */
export interface WorkBench {
    kind: 'work'
    arms: { label: string; prepare?: () => void | Promise<void>; run: () => void }[]
}

/** How many times a reader RE-RAN. In a reactive system this is the contract; values cannot show it. */
export interface WakeBench {
    kind: 'wake'
    arms: { label: string; run: () => Promise<{ count: number; of: string }> }[]
}

/**
 * What the emitted code COSTS, in the numbers this project budgets it in: DOM nodes per list item,
 * and microtask turns per row.
 *
 * Same arm shape as a wake bench, and reported the same way, because both are "a count with a name
 * for what was counted". A separate kind because the CLAIM is different: a wake bench says a reader
 * did not re-run, a budget bench says the work is the size it was meant to be, and a number that
 * quietly grows by an order of magnitude is invisible to both a timing and a correctness test.
 *
 * The third budget number — JS allocations per template node — is deliberately absent: no engine
 * this runs on exposes one, so it stays a thing to read off the emitted code rather than a counter
 * that would have to lie.
 */
export interface BudgetBench {
    kind: 'budget'
    arms: { label: string; run: () => Promise<{ count: number; of: string }> }[]
}

export interface Case {
    title: string
    note?: string
    run?: (ctx: Ctx) => void | Promise<void>
    interact?: (ctx: Ctx) => void
    bench?: Bench
}

export interface Suite {
    /** Route segment and test-file name: `state` → `/state`. */
    name: string
    title: string
    blurb: string
    cases: Case[]
}

/** Identity, for inference and one place to catch a suite that names nothing. */
export function suite(spec: Suite): Suite {
    if (spec.cases.length === 0) throw new Error(`abide: suite "${spec.name}" has no cases`)
    return spec
}

// --- the context a case is handed --------------------------------------------

/** Where a line goes. The card writes DOM; the headless runner collects. */
export interface Sink {
    line(line: LogLine): void
    live(line: LogLine): void
}

export function context(host: HTMLElement, sink: Sink): Ctx {
    const log = ((label: string, value?: unknown): void => {
        sink.line({ label, value: value === undefined ? '' : show(value), kind: 'note' })
    }) as Log
    log.live = (label: string, value: unknown): void => {
        sink.live({ label, value: show(value), kind: 'note' })
    }

    return {
        host,
        log,
        is(label, actual, expected) {
            const ok = equals(actual, expected)
            sink.line({
                label,
                value: ok ? show(actual) : `${show(actual)} ≠ ${show(expected)}`,
                kind: ok ? 'pass' : 'fail',
            })
            if (!ok) fail(label, actual, expected)
        },
        throws(label, fn, match) {
            let thrown: unknown
            let threw = false
            try {
                fn()
            } catch (error) {
                threw = true
                thrown = error
            }
            if (!threw) {
                sink.line({ label, value: 'did not throw', kind: 'fail' })
                fail(label, 'no throw', match ?? 'a throw')
            }
            if (!messageMatches(thrown, match)) {
                sink.line({ label, value: `threw ${show(thrown)}`, kind: 'fail' })
                fail(label, thrown, match)
            }
            sink.line({ label, value: `threw ${show(thrown)}`, kind: 'pass' })
        },
        async rejects(label, value, match) {
            let thrown: unknown
            let rejected = false
            try {
                await value
            } catch (error) {
                rejected = true
                thrown = error
            }
            if (!rejected) {
                sink.line({ label, value: 'resolved', kind: 'fail' })
                fail(label, 'resolved', match ?? 'a rejection')
            }
            if (!messageMatches(thrown, match)) {
                sink.line({ label, value: `rejected ${show(thrown)}`, kind: 'fail' })
                fail(label, thrown, match)
            }
            sink.line({ label, value: `rejected ${show(thrown)}`, kind: 'pass' })
        },
    }
}

/** Collects instead of rendering. What `bun test` runs a case through. */
export function collector(): { sink: Sink; lines: LogLine[] } {
    const lines: LogLine[] = []
    const at = new Map<string, number>()
    return {
        lines,
        sink: {
            line(line) {
                lines.push(line)
            },
            live(line) {
                const index = at.get(line.label)
                if (index === undefined) {
                    at.set(line.label, lines.length)
                    lines.push(line)
                } else {
                    lines[index] = line
                }
            },
        },
    }
}

/**
 * Run a case the way `bun test` does: the headless body, then one pass over every bench arm to prove
 * it still runs. `interact` is deliberately skipped — it needs a click, and a click is not a claim.
 */
export async function runHeadless(spec: Case): Promise<LogLine[]> {
    const { sink, lines } = collector()
    const host = document.createElement('div')
    document.body.append(host)
    try {
        await spec.run?.(context(host, sink))
        if (spec.bench !== undefined) await smokeBench(spec.bench)
    } finally {
        host.remove()
    }
    return lines
}

/**
 * One pass per arm. The TIMES are meaningless outside a real engine, so nothing is asserted about
 * them — what is asserted is that every arm still exists, still compiles, and still runs, which is
 * exactly what rots when a bench page is only ever opened by hand.
 */
export async function smokeBench(bench: Bench): Promise<void> {
    if (bench.kind === 'time') {
        for (const arm of bench.arms) {
            arm.prepare?.()
            const produced = arm.run(0)
            if (isThenable(produced)) await produced
        }
        return
    }
    if (bench.kind === 'work') {
        for (const arm of bench.arms) {
            await arm.prepare?.()
            arm.run()
        }
        return
    }
    // `wake` and `budget` are the same arm shape: a count, and a name for what was counted.
    for (const arm of bench.arms) {
        const { count } = await arm.run()
        if (!Number.isFinite(count)) {
            throw new AssertionError(`bench arm "${arm.label}" counted ${count}`, count, 'a finite count')
        }
    }
}

// --- the small tools a case reaches for --------------------------------------

/**
 * A recording reader — what a template slot is, reduced to its essentials. It keeps what it SAW,
 * including a throw, and `seen.length` is how many times it WOKE. The wake count is the half of the
 * contract values alone cannot show: a cell that reports the right thing while waking readers
 * nothing moved for is the wrong implementation.
 */
export interface Reader {
    seen: string[]
    dispose(): void
}

export function reader<T>(read: () => T): Reader {
    const seen: string[] = []
    const dispose = watch(() => {
        try {
            seen.push(show(read()))
        } catch (error) {
            seen.push(`THROW ${(error as Error).message}`)
        }
    })
    return { seen, dispose }
}

let kept: unknown

/**
 * Consume a bench arm's result.
 *
 * A benchmark whose result is never used is a benchmark the optimiser is free to delete, so every
 * timed arm has to hand its answer somewhere the engine cannot prove dead. `keptValue` is that
 * proof: it reads the variable, so the store into it survives.
 */
export function keep(value: unknown): void {
    kept = value
}

export function keptValue(): unknown {
    return kept
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Wait for a condition instead of sleeping past it.
 *
 * A case that sleeps a fixed span and then asserts how far something got is asserting the TIMER: a
 * stream yielding every 8 ms, given 20 ms, has landed two rows with a four-millisecond margin, and
 * that margin is gone the moment the machine is busy. Waiting for the state the claim is about makes
 * the same claim without a race in it.
 */
export async function until(ready: () => boolean, timeoutMs = 2_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (!ready()) {
        if (Date.now() > deadline) throw new Error('abide: `until` gave up waiting for its condition')
        await sleep(2)
    }
}

/**
 * Count the DOM calls a method makes across a region. Narrower than the work counters: this pins ONE
 * method, which is what a claim like "the class attribute was not touched" needs.
 */
export function countCalls<T extends object>(target: T, method: keyof T): { calls: number; restore(): void } {
    const original = target[method] as unknown as (...args: unknown[]) => unknown
    const record = {
        calls: 0,
        restore: (): void => {
            target[method] = original as T[keyof T]
        },
    }
    target[method] = function (this: unknown, ...args: unknown[]) {
        record.calls++
        return original.apply(this, args)
    } as unknown as T[keyof T]
    return record
}

/** A container in the document, plus the removal a case owes it. */
export function container(): HTMLElement {
    const host = document.createElement('div')
    document.body.append(host)
    return host
}
