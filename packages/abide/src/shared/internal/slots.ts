// What the two substrates need from a template beyond its public surface: the cached slot scan, and
// the two recognisers that let a renderer decide what a slot value IS.
//
// Both live here rather than in `$shared/html.ts` because neither is authoring vocabulary — nobody
// writing a component calls them — and because keeping them together is what stops `$ui` and
// `$server` growing their own idea of a slot.

import { classifySlots, type SlotKind, type TemplateResult } from '../html.ts'
import { SOURCE } from './BRANDS.ts'

// Templates are identified by their `strings` identity — a tagged template literal produces the same
// array object on every evaluation, so one call site parses/scans exactly once.
const scanCache = new WeakMap<readonly string[], SlotKind[]>()

export function slotsOf(result: TemplateResult): SlotKind[] {
    let kinds = scanCache.get(result.strings)
    if (kinds === undefined) {
        kinds = classifySlots(result.strings)
        scanCache.set(result.strings, kinds)
    }
    return kinds
}

// A SOURCE — `state`, `memo` or `channel` — is callable, so it is recognised by its brand rather
// than by being a function. The symbol lives in `./BRANDS.ts` because both substrates must recognise
// one and neither may import the reactive graph to do it: the server has none.
//
// `source` is the right question here, not `cell`. A cell is a source you can also `set` and `await`;
// a channel is a source that is neither. What a slot needs to know is only whether to READ it.
export function isSource(value: unknown): value is () => unknown {
    return typeof value === 'function' && SOURCE in value
}

// A value in any slot may be a thunk. That is the ONE reactivity convention: the server calls it,
// the client wraps it in an effect. Same authoring, both substrates.
//
// A thunk that hands back a SOURCE is read one more step: `${() => search({q: filter()})}` produces
// the slot's handle, and a handle in a slot means its value. One step only — a source that returns a
// source is not a thing.
export function unwrap(value: unknown): unknown {
    if (typeof value !== 'function') return value
    const produced = (value as () => unknown)()
    return isSource(produced) ? produced() : produced
}
