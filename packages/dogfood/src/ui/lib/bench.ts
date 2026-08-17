// The PAINTING half of the bench table: which class each fact a row reports gets.
//
// The measuring half is `harness`'s — `benchRowsOf` builds the rows and runs the arms, and what it
// hands back says which arm is the subject, which is the harness floor, how full a bar would be and
// which way the ratio went. None of that is a class, on purpose: the perf app draws the same rows and
// may not ship a stylesheet at all, so a row carrying `is-abide` would be a row only one app can
// use. This file is the other side of that seam, and it is the whole of what this app adds.

import type { ArmRow, BenchRow } from 'harness'
import { benchRowsOf } from 'harness'
import { allSuites } from '#shared/demos/index.ts'

export type { ArmRow, BenchRow }

const SUBJECT = 'arm-label is-abide'
const OTHER = 'arm-label'
const FLOOR_TONE = 'arm-label is-floor'

const TONE: Record<'faster' | 'same' | 'slower', string> = {
    faster: 'tail is-good',
    same: 'tail is-good',
    slower: 'tail is-bad',
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
    return arm.floor ? 'is-floor' : arm.subject ? 'is-abide' : ''
}

/** How wide the bar is. A floor of 2% so an arm that is 400x faster is still a mark rather than nothing. */
export function armWidth(arm: ArmRow): string {
    return `${Math.max(2, arm.fill() * 100)}%`
}

export function tailTone(arm: ArmRow): string {
    const which = arm.tailVerdict()
    return which === '' ? 'tail' : TONE[which]
}
