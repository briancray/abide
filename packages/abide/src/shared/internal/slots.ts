// What the two substrates need from a template beyond its public surface: the cached slot scan, and
// the two recognisers that let a renderer decide what a slot value IS.
//
// Both live here rather than in `#shared/html.ts` because neither is authoring vocabulary — nobody
// writing a component calls them — and because keeping them together is what stops `#ui` and
// `#server` growing their own idea of a slot.

import { classifySlots, type SlotKind, type TemplateResult } from '../html.ts'
import { isSource } from './BRANDS.ts'

/** What a call site's `strings` mean, worked out once: the slot kinds, and the text as it is EMITTED. */
interface TemplatePlan {
    kinds: SlotKind[]
    /**
     * Each static string with the `name=` an attribute slot owns already cut off.
     *
     * A PACKED COPY, and that is the point rather than a side effect. `result.strings` is a
     * `TemplateStringsArray`, which the language freezes, and a frozen array indexes through a slower
     * mode in JSC: reading six elements out of one measured ~50 ns against ~9.5 ns for an ordinary
     * copy of the same strings. The server's render walk reads this array once per slot per ROW, so
     * that is the shape rule arriving from the language rather than from anything written here.
     *
     * The slice rides along for free — it was a loop-invariant substring recomputed once per
     * attribute slot per row, and doing it here means the emit loop appends without deciding.
     */
    texts: string[]
}

// Templates are identified by their `strings` identity — a tagged template literal produces the same
// array object on every evaluation, so one call site parses/scans exactly once.
const scanCache = new WeakMap<readonly string[], TemplatePlan>()

export function planOf(result: TemplateResult): TemplatePlan {
    let plan = scanCache.get(result.strings)
    if (plan === undefined) {
        const strings = result.strings
        const kinds = classifySlots(strings)
        const texts: string[] = []
        for (let i = 0; i < strings.length; i++) {
            const text = strings[i] as string
            const kind = kinds[i]
            texts.push(
                kind === undefined || kind.kind === 'child'
                    ? text
                    : text.slice(0, text.length - kind.staticTail),
            )
        }
        plan = { kinds, texts }
        scanCache.set(strings, plan)
    }
    return plan
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

/**
 * `<slot>fallback</slot>` — the children, or what to show when there are none.
 *
 * Here beside `unwrap` because it is the same read: children reach a component as a state the position
 * writes on every pass, so deciding whether any arrived means reading through one — and a second
 * implementation of that step is the drift this file exists to stop.
 *
 * NOTHING is `undefined`, `null` or `false`, which is the triple `attributeText` already means by an
 * absent value. An empty string is not one of them: a caller that passed something empty passed
 * something, and the fallback is for a caller who passed nothing.
 *
 * The fallback is a THUNK so that what it reads is read only when it is shown — evaluated eagerly, a
 * state inside it would subscribe this slot to a value the caller's children have made invisible.
 */
export function slotted(children: unknown, fallback: () => unknown): unknown {
    const value = unwrap(children)
    return value === undefined || value === null || value === false ? fallback() : value
}
