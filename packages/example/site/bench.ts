// The PAINTING half of the bench table: which Tailwind ramp each fact a row reports gets.
//
// The measuring half is `abide-kit`'s — `benchRowsOf` builds the rows and runs the arms, and what it
// hands back says which arm is the subject, which is the harness floor, how full a bar would be and
// which way the ratio went. None of that is a class, on purpose: the perf app draws the same rows and
// may not ship a stylesheet at all, so a row carrying `text-sky-300` would be a row only one app can
// use. This file is the other side of that seam, and it is the whole of what this app adds.

import type { ArmRow, BenchRow } from 'abide-kit'
import { benchRowsOf } from 'abide-kit'
import { allSuites } from '../demos/index.ts'

export type { ArmRow, BenchRow }

const SUBJECT = 'text-sky-300'
const OTHER = 'text-slate-300'
const FLOOR_TONE = 'text-slate-500 italic'

const TAIL = 'text-xs text-right'
const QUIET = `text-slate-600 ${TAIL}`
const TONE: Record<'faster' | 'same' | 'slower', string> = {
    faster: `text-emerald-400 ${TAIL}`,
    same: `text-emerald-400 ${TAIL}`,
    slower: `text-amber-400 ${TAIL}`,
}

/** Every benched case in this app, in nav order. */
export async function benchRows(): Promise<BenchRow[]> {
    return benchRowsOf(await allSuites())
}

/** The arm's own colour: abide is the subject, the floor is noise, everything else is an arm. */
export function armTone(arm: ArmRow): string {
    return arm.floor ? FLOOR_TONE : arm.subject ? SUBJECT : OTHER
}

export function armBar(arm: ArmRow): string {
    return arm.floor ? 'bg-slate-700' : arm.subject ? 'bg-sky-500' : 'bg-slate-600'
}

/** How wide the bar is. A floor of 2% so an arm that is 400x faster is still a mark rather than nothing. */
export function armWidth(arm: ArmRow): string {
    return `${Math.max(2, arm.fill() * 100)}%`
}

export function tailTone(arm: ArmRow): string {
    const which = arm.tailVerdict()
    return which === '' ? QUIET : TONE[which]
}
