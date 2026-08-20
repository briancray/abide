// The harness's front door — one shape for a demonstration, a test and a bench.
//
// A demo that is only a demo rots: it renders something plausible and nobody notices when the
// plausible thing is wrong. A test that is only a test documents nothing. So there is ONE shape
// here, a `Case`, with five optional faces:
//
//   run       the headless body. Assertions live here, and it runs BOTH under `bun test` and inside
//             the browser — the same code, so the two can never drift.
//   server    server only, and `run`'s mirror image: assertions that need something a browser does
//             not have. `serve()` is the whole of the reason it exists — a request scope is an
//             `AsyncLocalStorage`, so the four `request` cases threw on the `/tests` page and were
//             red there for as long as that page had existed while `bun test` stayed green. A face
//             rather than a flag, so which substrate a body needs is declared by WHERE IT IS WRITTEN,
//             the way `interact` already declares the opposite.
//   visit     browser only, and a DOCUMENT of its own — a frame, its own realm, its own shell. The
//             claims a fragment cannot carry: a served page adopting through a whole document, a
//             patch script swapping a deferred region in, a use case measured on a shell with no CSS
//             on it. Browser only because only chromium RUNS what is written into a frame; happy-dom
//             parses it and leaves the scripts as text, so the mechanism under test never fires.
//   interact  browser only: buttons, inputs, a live area to poke. Never runs headless, because a
//             claim that needs a click is a claim no test can make.
//   bench     measurement arms. Reported in the browser as ratios; smoke-run headless, so an arm
//             that no longer compiles or throws is caught by `bun test` even though its NUMBERS
//             mean nothing outside a real engine.
//
// Assertions are not `bun:test`'s `expect`, because the same assertion has to run where there is no
// test runner. `ctx.is(...)` records a line and throws an `AssertionError` on mismatch: the runner
// turns that into a failed test, the page paints it red.
//
// This entry point imports `abide` and — for `scratch` — `abide/ui`; `harness/measure` deliberately
// imports neither, and the numbers live there for that reason. `harness/spawn` is the third, and is
// bun-only.

// `watch` because a recording reader IS an effect.
import { type TemplateResult, watch } from 'abide'
// `SourceFile` is a TYPE and is erased, so naming the compiler here costs the graph nothing: it is
// what `?source` hands back, and `Example` below is the thing that holds two of them.
import type { SourceFile } from 'abide/compiler'
// `swallowed` for that reader: it ACTS on each observation rather than returning one, so the run
// boundary that discards a swallowed signal's value comes too late — the push already happened.
import { swallowed } from 'abide/runtime'
// `abide/ui` for `scratch` below, and it costs this entry point nothing on a server: the entry's two
// installs are guarded, so importing it where there is no document is a no-op rather than a throw.
import { mount, type Mounted } from 'abide/ui'
import { AssertionError, equals, fail, messageMatches, show } from './internal/assert.ts'
import type { Arm } from './internal/bench.ts'
import type { Framed } from './internal/frame.ts'
import { isThenable } from './internal/probes.ts'

// Beside the `Case` that carries them: an assertion is how a case states a claim.
export { AssertionError, equals, show } from './internal/assert.ts'
export { type Loopback, loopback } from './internal/loopback.ts'
// Running a page of cases in a browser: one at a time, because the counters are global.
export { enqueue, running, type Running, type Status } from './internal/queue.ts'
// A document of a case's own. `Framed` is on `Case.visit`, so it is surface either way.
export { framed, type Framed } from './internal/frame.ts'
// Everything known about one case, as one record — the join a consumer would otherwise make itself.
export {
    type Face,
    type Metric,
    type Profile,
    profileOf,
    substrate,
    type Substrate,
} from './internal/profile.ts'
// A bench as ROWS — the measuring half of a table, with nothing in it about how a table looks.
export {
    type ArmRow,
    type BenchHandle,
    benchRow,
    type BenchRow,
    benchRowsOf,
    exposeBench,
} from './internal/rows.ts'

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
    /** The live area. A div in the document headless, removed when the case ends; the card's body in the browser. */
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
    /** Assertions that need a server — see the four faces at the top of this file. */
    server?: (ctx: Ctx) => void | Promise<void>
    /**
     * Assertions that need a DOCUMENT of their own — a frame, with its own realm and its own shell.
     *
     * `run`'s other mirror image, and browser only for a MEASURED reason rather than a stylistic one:
     * both lanes hand back a usable frame document, and only chromium runs the scripts written into
     * it. So a served page patching a deferred region into itself, or adopting what a server wrote
     * through a whole document rather than a fragment, is a claim `bun test` cannot make — it would
     * have to simulate the very mechanism under test. `runHeadless` says so instead of passing.
     */
    visit?: (ctx: Ctx, frame: Framed) => void | Promise<void>
    interact?: (ctx: Ctx) => void
    bench?: Bench
}

/**
 * One RUNG of a capability's ladder: the smallest file that introduces exactly one new thing.
 *
 * A capability's fourth face, and the reason it hangs off the suite rather than off a case: a case
 * asserts one facet and there are eight of them, while what a reader wants first is the shape of the
 * thing written down. The cases are the claims ABOUT it.
 *
 * `adds` is the ONE thing this rung introduces that the rung before it did not — and the reason the
 * ladder is an array rather than a single example. One file showing content slots, attribute slots,
 * toggles, blocks and keys together is not a small example of five things, it is a large example of
 * none: a reader cannot tell which line is responsible for which behaviour, so nothing in it can be
 * copied with confidence. The ladder makes the DIFF between two rungs the whole of the lesson.
 *
 * `source` is the file's own text, inlined by the loader — `import SOURCE from './x.abide?source'` —
 * rather than read at runtime or recovered from `Function.prototype.toString`, both of which report
 * the BUNDLER's text once the app is built. So what a reader is shown is what an author wrote, in
 * every lane.
 *
 * `view` is absent on about half of them, and that is the honest shape rather than an oversight: a
 * lifecycle hook, a config declaration and a server module are examples with nothing to render. What a
 * rung always has is text; whether it has a picture is a fact about the capability.
 */
export interface Example {
    /** What this rung introduces, as a phrase: `a promise is a load, not a value`. */
    adds: string
    /**
     * The aside beside this rung — what is easy to get wrong about THIS step, in a sentence or two.
     *
     * OPTIONAL, unlike the `pitfall` a callable and a spelling each carry, and the asymmetry is the
     * point: a page always has one thing worth warning about, and a rung usually does not. `adds`
     * already says what the step is for, so a note that only restated it would be furniture.
     *
     * Written where the diff between two rungs is not self-evident from the two files — which is most
     * often the rung that introduces a spelling whose WRONG version also works.
     */
    note?: string
    /**
     * The names an AUTHOR TYPES that this rung introduces — what `/docs/<callable>` is keyed by.
     *
     * Almost always one: a rung adds one thing, and the name of that thing is this. More than one only
     * when the names are one idea spelled several ways — `PUT`/`PATCH`/`DELETE` differ by the method
     * string alone, and `error`/`HttpError` are the throw and the type it throws.
     *
     * EMPTY is legal and means the rung is about something no author calls by name: `mount` and
     * `hydrate` are reached by `abide build`'s generated client entry, so the ladders demonstrating them
     * belong to `/tests` and `/bench` and to no docs page. An empty one is not a way to opt out quietly
     * — `packages/dogfood/test/docs.test.ts` holds the list of ladders allowed to have them, in both
     * directions, so a rung that stops claiming its name fails there.
     */
    of: readonly string[]
    /**
     * The template SPELLINGS this rung introduces — what `/docs/syntax/<slug>` is keyed by.
     *
     * The second claim a rung can make, and it exists because the first one cannot reach the template:
     * `of` is keyed by a name an author IMPORTS, and `{#for}`, `bind:value` and `<slot/>` import
     * nothing. A reader who met one of those in a file has no name to look up, so a rung about one used
     * to be reachable from no page at all.
     *
     * ABSENT rather than empty on the ladders that demonstrate no syntax, which is most of them — a
     * server-side rung would otherwise carry `spells: []` for the same reason a template rung does not
     * carry `of: []` about the modules it never mentions. The two claims are independent: a rung can
     * make both (`props` and `<Name/>`), either, or — on `client` and `hydrate` — neither.
     */
    spells?: readonly string[]
    /** The file the rung is ABOUT, text and name — what a `?source` import hands back. */
    source: SourceFile
    /**
     * The SECOND file, when one file cannot show the thing on its own — the file `view` was compiled
     * from.
     *
     * A rung that spans the seam is TWO files and always was; what changed is that the page now shows
     * both. An endpoint under `server/rpc/**` is the declaration a reader came for, and it is also the
     * half a browser never receives, so a page showing it alone documents a call nobody can make: the
     * reader is left to guess the spelling of the call site, which is the part they were about to write.
     *
     * The seam is the usual reason and not the only one: a component whose prop is the PARENT's state
     * has nothing to mount it with either, and the parent is the second file for the same reason the
     * browser half is. Which is why the two panes are labelled with the FILENAMES the loader reported
     * rather than with the two lanes — `server` / `client` was a true pair for every rung that had one
     * right up until a rung had two files in the same lane.
     *
     * ABSENT on the rungs whose demonstration IS `source` — a `.abide` file is one file in both lanes,
     * and repeating its text under a second label would claim a seam it does not cross.
     */
    client?: SourceFile
    /**
     * A compiled `.abide` default export, which is exactly this signature.
     *
     * Present on every rung that has anything to SHOW, which since the seam-crossing ladders grew a
     * browser half is every rung on `/docs`. A view whose result comes from the server is driven by a
     * button rather than loaded on sight, and that is not decoration: `demos/proofs.ts` renders each
     * view on both substrates and compares them, so a rung that fetched while it mounted would be
     * asserting a round trip inside `bun test`. Idle before the click, both arms write the same markup.
     */
    view?: (args: { children?: unknown }) => TemplateResult
}

export interface Suite {
    /** Route segment and test-file name: `state` → `/state`. */
    name: string
    title: string
    blurb: string
    cases: Case[]
}

/**
 * Identity, for inference and one place to catch a suite that names nothing.
 *
 * A suite used to CARRY its ladder, back when `/docs` was keyed by capability and a suite page was
 * where the rungs were shown. `/docs` is keyed by CALLABLE now, so the ladders are read straight out of
 * `fixtures/<suite>/ladder.ts` by whatever needs them and the field had twenty-one writers and no
 * reader but its own validator. What it validated moved to `dogfood/test/docs.test.ts`, which already
 * walks every ladder.
 */
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
 *
 * `server` runs HERE and nowhere else. This is the only runner on a server, which is what makes the
 * face worth having: the assertions are ordinary and it is the substrate that is not.
 */
export async function runHeadless(spec: Case): Promise<LogLine[]> {
    const { sink, lines } = collector()
    const host = document.createElement('div')
    document.body.append(host)
    try {
        await spec.run?.(context(host, sink))
        await spec.server?.(context(host, sink))
        // Said out loud rather than skipped quietly: a frame in this lane parses what is written into
        // it and runs none of it, so a `visit` body would be asserting about a document that never
        // came alive. The browser row on `/tests/<suite>` is where it is actually claimed.
        if (spec.visit !== undefined) {
            sink.line({ label: 'browser only', value: 'a frame here runs no scripts', kind: 'note' })
        }
        if (spec.bench !== undefined) await smokeBench(spec.bench)
    } finally {
        host.remove()
        sweepContainers()
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
 * contract values alone cannot show: a state that reports the right thing while waking readers
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
            const value = read()
            // A read with nothing to serve YET is not an observation — the body did not finish and
            // the graph will run it again. Asked BEFORE the push rather than in the catch below,
            // because `read` may swallow its own signal and hand back a value it never had: the
            // boundary discards that value, but a recorder that pushed it has already counted a pass
            // the reader never made.
            if (swallowed()) return
            seen.push(show(value))
        } catch (error) {
            // The same question on the arm where the signal reached this catch instead — it is the
            // read's own throw, so `outstanding` is set here too, and one predicate covers both ways
            // in. Handed back, because the graph runs this body again when the load lands.
            if (swallowed()) throw error
            seen.push(`THROW ${(error as Error).message}`)
        }
    })
    return { seen, dispose }
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Wait for a condition instead of sleeping past it.
 *
 * A case that sleeps a fixed span and then asserts how far something got is asserting the TIMER: a
 * stream yielding every 8 ms, given 20 ms, has landed two rows with a four-millisecond margin, and
 * that margin is gone the moment the machine is busy. Waiting for the state the claim is about makes
 * the same claim without a race in it.
 *
 * `what` names the condition in the failure, because a case that waits on three things in a row
 * reports the same line for all three otherwise, and the wait that gave up is the whole diagnosis.
 */
export async function until(ready: () => boolean, what = 'its condition', timeoutMs = 2_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (!ready()) {
        if (Date.now() > deadline) throw new Error(`abide: \`until\` gave up waiting for ${what}`)
        await sleep(2)
    }
}

/**
 * Scratch space in the document for a case to render into.
 *
 * Under ONE holder rather than straight into `document.body`, and that is the whole of the change
 * from a bare append. Removing it was the case's to do — and a case that THREW never got there, and a
 * bench arm that makes one per iteration never even intended to. Headless that is invisible; in a
 * browser card `document.body` IS the page somebody is reading, so the leftovers stack up unstyled
 * under the last card, which is exactly how this was noticed.
 *
 * A holder rather than a list of what was handed out, because a bench arm runs thousands of
 * iterations: an array would hold a reference to every detached node until the sweep, which is the
 * retention this is meant to end rather than relocate.
 */
let HOLDER: HTMLElement | null = null

export function container(): HTMLElement {
    // `isConnected` as well as null, because a case is entitled to clear the document out from under
    // this — `mount(...).dispose()` on a body-level container, a test that resets the DOM.
    if (HOLDER === null || !HOLDER.isConnected) {
        HOLDER = document.createElement('div')
        HOLDER.setAttribute('data-abide-scratch', '')
        document.body.append(HOLDER)
    }
    const host = document.createElement('div')
    HOLDER.append(host)
    return host
}

/**
 * Scratch space with a VIEW already in it — `container()` and the `mount` over it, as one call.
 *
 * A host and the root that writes into it are two things with ONE lifetime, and only the host was
 * ever cleaned up. Sweeping drops the nodes, which is what a page looks like; the root goes on
 * subscribing to every state the view read, so the next write to one of those still reaches a
 * component nobody can see — and a bench counting that write counts it once per copy left behind.
 * The parity arms on `/bench/compiler` read 2 DOM calls on their first run and 4 on their second for
 * exactly that reason, with the markup correct throughout and no test able to see it.
 *
 * So the disposal is the mechanism's rather than the author's: every runner sweeps in a `finally`, so
 * a view rendered through here cannot outlive the case or the bench row that rendered it. `mount` and
 * `container()` by hand still compile and are still right where a case DISPOSES on purpose — timing
 * what a teardown costs, or asserting that one happened.
 *
 * The `Mounted` list is per MOUNT, not per iteration, which is what makes it affordable where the
 * holder alone could not be: an arm mounts in `prepare` and writes states in `run`.
 */
export function scratch(view: () => TemplateResult): HTMLElement {
    const host = container()
    MOUNTED.push(mount(host, view))
    return host
}

const MOUNTED: Mounted[] = []

/**
 * Drop whatever the last case left behind — the roots `scratch` made, and then the nodes. Idempotent,
 * and free for a case that cleaned up after itself, which is still the ordinary thing for a case to
 * do because removing its own container is sometimes part of what it is measuring.
 *
 * Roots first: a disposal writes to the nodes it is taking down, and doing it after the holder is
 * emptied would be a teardown against detached DOM — right, but not the thing that was measured.
 */
export function sweepContainers(): void {
    for (const held of MOUNTED) held.dispose()
    MOUNTED.length = 0
    HOLDER?.replaceChildren()
}
