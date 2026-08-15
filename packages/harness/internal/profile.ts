// Everything known about one case, as a record — and nothing about how to show it.
//
// The facts were already here; what was missing is a NAME for all of them at once. A status and its
// lines live on `Running`, the measurements live on a `BenchRow`, which faces a case carries is a
// fact about the `Case`, and which substrate answered is a fact about the lane. Four places, so a
// consumer that wants "what is known about this" assembles it itself — and the fourth one to want it
// would assemble it slightly differently.
//
// This is that join, and the seam it respects is the one CLAUDE.md already states: FACTS come from
// the harness and become CLASSES in `site/`. Nothing here knows about a badge.
//
// TWO fields are load-bearing rather than bookkeeping.
//
// `substrate` — because a number without it describes the emulator. A profile is therefore PER LANE:
// the same case run under `bun test` and in a browser produces two, and a consumer that wants both
// shows two rather than merging them into a number from nowhere.
//
// `faces` — because a claim a lane cannot make must be visible rather than absent. A case carrying a
// `visit` shows that it does even where no frame ran it, which is the same reasoning that made
// `server` a face rather than a flag.

import type { BenchRow } from './rows.ts'
import type { LogLine } from '../harness.ts'
import type { Status } from './queue.ts'

/** Which prover a case carries. Named for the field on `Case`, so there is one vocabulary. */
export type Face = 'run' | 'server' | 'visit' | 'interact' | 'bench'

/**
 * Where a profile was produced.
 *
 * `bun` covers the emulator: `bun test` has a document, and it is happy-dom's rather than an engine's
 * — which is exactly the distinction a reader needs before believing a count. See the `splitText`
 * note in `dom.ts` for what the two disagree about.
 */
export type Substrate = 'bun' | 'browser'

/** One measured number, with what it is a number OF. */
export interface Metric {
    label: string
    kind: 'time' | 'work' | 'wake' | 'budget'
    /** Rendered by whoever measured it — `1.34 ms`, `1,004`, `2 allocs`. Never re-formatted here. */
    value: string
    /** The batch size the value is over. No number here is readable without it. */
    per?: string
    /** Abide divided by the hand-written arm, when there is one to divide by. */
    ratio?: string
}

export interface Profile {
    title: string
    note?: string
    suite: string
    /** Where this one was produced. A second lane is a second profile, never a merge. */
    substrate: Substrate
    /** Every prover the case CARRIES, including the ones this lane could not run. */
    faces: Face[]
    status: Status
    lines: LogLine[]
    metrics: Metric[]
}

/** Which lane is asking. `Bun` is the one global that is true here and absent in a browser bundle. */
export function substrate(): Substrate {
    return 'Bun' in globalThis ? 'bun' : 'browser'
}

/** The faces a case carries, in the order the header of `harness.ts` lists them. */
export function facesOf(spec: {
    run?: unknown
    server?: unknown
    visit?: unknown
    interact?: unknown
    bench?: unknown
}): Face[] {
    const faces: Face[] = []
    if (spec.run !== undefined) faces.push('run')
    if (spec.server !== undefined) faces.push('server')
    if (spec.visit !== undefined) faces.push('visit')
    if (spec.interact !== undefined) faces.push('interact')
    if (spec.bench !== undefined) faces.push('bench')
    return faces
}

/**
 * One case's profile, assembled from what is already known about it.
 *
 * The `row` is optional because most cases carry no bench, and an empty `metrics` is the honest
 * answer there rather than a zero.
 */
export function profileOf(
    spec: { title: string; note?: string; run?: unknown; server?: unknown; visit?: unknown; interact?: unknown; bench?: unknown },
    held: { status: () => Status; lines: () => LogLine[] },
    suite: string,
    row?: BenchRow,
): Profile {
    const profile: Profile = {
        title: spec.title,
        suite,
        substrate: substrate(),
        faces: facesOf(spec),
        status: held.status(),
        lines: held.lines(),
        metrics: row === undefined ? [] : metricsOf(row),
    }
    // Same rule as the metric's two: present when there is one, absent otherwise.
    if (spec.note !== undefined) profile.note = spec.note
    return profile
}

/**
 * A bench row as metrics — the headline number and the ratio it exists to state.
 *
 * The RATIO comes off the hand-written arm rather than off abide's, because that is where the row
 * phrases it: `handWritten` is `null` for the several benches that compare two abide spellings, and
 * `undefined` here is the honest answer for those rather than a comparison nobody made.
 */
function metricsOf(row: BenchRow): Metric[] {
    const metric: Metric = {
        label: row.title,
        kind: row.kind,
        value: row.abide.value(),
    }
    // Assigned only when there IS one, never as an explicit `undefined`: `exactOptionalPropertyTypes`
    // is on, and it is on for this reason — "absent" and "present and unknown" are different answers.
    const ratio = row.handWritten?.tail()
    if (ratio !== undefined) metric.ratio = ratio
    // Empty means "one op is one op" — a `per` of `''` printed as a unit would read as a missing one.
    if (row.per !== '') metric.per = row.per
    return [metric]
}
