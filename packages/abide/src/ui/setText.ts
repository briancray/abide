import { WORK } from '#shared/WORK.ts'
import { markupToText, RawRun } from './RawRun.ts'

/**
 * Writes a slot's text, skipping an unchanged write; returns the run as a text node.
 *
 * What a slot's binding writes, and where a COMPILED SLOT RUNNING is counted. The emitted watch
 * writes `setText(node, escapeless(a) + '…' + escapeless(b))` — or `setMarkup` where a part is
 * `Raw` (32.26) — the node resolved once before it, so this is the LAST call in it and the only one
 * that runs exactly once per slot however many dynamic parts the run has. `bindingRuns` is counted
 * here rather than in the emitted code so the count is a property of the runtime and not of what a
 * particular emitter remembered to write.
 *
 * The COMPARE is the rest of the point: a write to `data` that does not change it still costs,
 * and a slot rerun by a value that landed on the same string is the common case rather than the
 * rare one.
 *
 * THE RUN'S STATE COMES BACK, because a run that held markup is a text node again after this and the
 * binding holds whichever it is. For a run that held text — every run whose value was never `Raw` —
 * it is the node it was handed.
 */
export function setText(target: Text | RawRun, value: unknown): Text {
    WORK.bindingRuns += 1
    const next = value == null ? '' : String(value)
    if (target instanceof RawRun) return markupToText(target, next)
    if (target.data !== next) target.data = next
    return target
}
