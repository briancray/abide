// WHAT ONE EXAMPLE COST, IN THE BROWSER THE READER BROUGHT. The record the live panel
// renders, and the one thing in this package assembled for a reader rather than for a
// gate.
//
// It carries its own provenance because it has to: the same graph reads 1.67x a
// hand-written signal under JSC and 0.21x under V8, so a number with no engine beside
// it is a number two readers would disagree about while both being right.
import type { Ratio } from '../report/ratio.ts'
import type { Work } from './Work.ts'

export type ArmReading = {
    // Counts for this arm's op. Exact and machine-independent — a swap moves two
    // elements on a phone and on a workstation.
    work: Work
    // THIS MACHINE, THIS MINUTE.
    nanosecondsPerOp: number
    p95: number
}

export type Reading = {
    // The op the timing half priced. `'load'` where nothing repeatable was named.
    op: string
    substrate: 'jsc' | 'v8' | 'spidermonkey' | 'unknown'
    // What to show a reader. An engine name answers `ratio()`; this answers "is that
    // my browser?".
    agent: string
    // WHICH ARM RENDERED THE PAGE. Only one can: two arms cannot both own a document,
    // so the load half is single-armed by construction where the op half is not.
    loadedArm: string
    load: Work
    // One entry per arm that RAN. Absent from here is an arm that does not exist yet,
    // which is how the abide column stays empty rather than zero.
    arms: Record<string, ArmReading>
    // AGAINST THE BASELINE ARM, through `ratio()` — so it inherits every refusal: a
    // substrate mismatch, an arm compared with itself, a value inside the measured
    // floor. Empty where only one arm ran, which is not the same as a ratio of 1.
    ratios: Record<string, Ratio>
    // Shared by every arm, because they were batched in ONE call: growing n per arm
    // separately would make the two incomparable and `ratio()` would refuse them.
    timing: {
        n: number
        reps: number
        // The A/A spread measured on this machine, this minute: one arm run twice. A
        // reader on a busy laptop gets a wide floor and should.
        floor: number
    } | null
    // The browser's own timeline, which no lane produces and every browser has.
    paint: {
        firstPaint: number | null
        firstContentfulPaint: number | null
        // Tasks over 50 ms during load. A frame that blocks is the one thing a reader
        // can feel without measuring anything.
        longTasks: number
    }
    // Nodes in the document the arm built, and the bytes of the script that built it.
    size: { nodes: number; scriptBytes: number }
    // Measured once for this substrate, and reported because it decides what the
    // timing half is worth: 41 ns under bun, 100 µs in chromium, 1 ms in webkit.
    clockNanoseconds: number
}
