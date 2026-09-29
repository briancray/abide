// WHAT A `bind:` OPERAND HOLDS, read and written — the one place its two forms are told apart: a
// `Reactive` (32.5, 32.6) or an explicit `{ get, set }` pair (the registry's `bind:value={{get, set}}`),
// on an element and on a component alike.
// THE BRAND IS READ FIRST (1.6): a `Reactive` is callable and has members of its own.

import { isReactive } from './reactive/isReactive.ts'
import { pairReactive } from './reactive/pairReactive.ts'

type Pair = { get(): unknown; set(value: unknown): void }

/** The value a `bind:` operand holds, read so the caller subscribes. */
export function boundValue(operand: unknown): unknown {
    if (isReactive(operand)) return (operand as () => unknown)()
    return (operand as Pair | null | undefined)?.get?.()
}

/**
 * The value held, without subscribing whoever asks.
 *
 * What a listener reads to decide what to write.
 */
export function heldValue(operand: unknown): unknown {
    if (isReactive(operand))
        return (operand as unknown as { peek(): unknown }).peek()
    return (operand as Pair | null | undefined)?.get?.()
}

/** Writes a value through a `bind:` operand. */
export function writeBound(operand: unknown, value: unknown): void {
    if (isReactive(operand))
        (operand as unknown as { set(value: unknown): void }).set(value)
    else (operand as Pair | null | undefined)?.set?.(value)
}

/**
 * A `bind:` on a component, as the prop accessor the child is handed.
 *
 * 32.6 — its value to a child that reads the prop, and a `Reactive` to the cell a child that
 * writes it builds (`propCell`) — the caller's own, or one over the pair. HERE rather than in the
 * cell, which cannot tell a pair from a value that happens to have a `get` and a `set`: a `Map`
 * passed without `bind:`.
 */
export function boundProp(hold: () => unknown): (held?: true) => unknown {
    return (held) => {
        const operand = hold()
        if (!held) return boundValue(operand)
        return isReactive(operand) ? operand : pairReactive(operand as Pair)
    }
}

/**
 * Whether a `bind:group` member is checked: the group's value is its own value, or holds it.
 *
 * 32.8.
 */
export function groupHolds(group: unknown, value: unknown): boolean {
    return Array.isArray(group) ? group.includes(value) : group === value
}
