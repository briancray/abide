import { WORK } from '#shared/WORK.ts'
import { RawRun, refillRun, textToMarkup } from './RawRun.ts'

/**
 * Writes markup into a live run while part of it is `Raw`; returns the run's new state.
 *
 * 32.27 — what a live run's binding writes while a part of it is `Raw`: the run's markup, parsed
 * between its anchors. `setText`'s other half, and the run's new state is what it hands back —
 * the binding holds whichever the last write made.
 *
 * THE COMPARE IS `setText`'s: markup that landed on the same string is not parsed again, and a run
 * the server painted keeps its nodes (see `RawRun`).
 */
export function setMarkup(target: Text | RawRun, markup: string): RawRun {
    WORK.bindingRuns += 1
    if (!(target instanceof RawRun)) return textToMarkup(target, markup)
    if (target.html === undefined) target.html = markup
    else if (target.html !== markup) refillRun(target, markup)
    return target
}
