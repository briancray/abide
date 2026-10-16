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

/**
 * Whether a `<select>`'s bound value selects an option: it is the option's value, or a list
 * holding it.
 *
 * 32.61, 32.62 — compared as TEXT, unlike `groupHolds`: a select's value is written to the
 * property as its text, so a number selects the option whose value spells it.
 */
export function selectHolds(value: unknown, option: string): boolean {
    if (!Array.isArray(value))
        return value !== undefined && value !== null && String(value) === option
    for (const member of value) if (String(member) === option) return true
    return false
}

// An `<option` open tag: the name, then attributes up to the `>` that ends it, a quoted value
// carrying any `>` it holds.
const OPTION_TAG = /<option(?=[\s>])((?:[^>"']|"[^"]*"|'[^']*')*)>/gi
const VALUE_ATTRIBUTE = /\svalue\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i
// What ends an option's text where it has no `value`: the next tag that is not a comment.
const OPTION_TEXT_END = /<(?!!--)/
const COMMENT = /<!--[\s\S]*?-->/g
const REFERENCE = /&(?:#(\d+)|#x([\da-f]+)|(amp|lt|gt|quot|apos));/gi
const NAMED: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
}

/**
 * A `<select>`'s rendered options with `selected` written on each its bound value selects.
 *
 * 32.61 — THE SERVER'S HALF OF THE PROPERTY: a select's value is no attribute of its own, so the
 * painted page carries it on the options. Read off the markup rather than the template, because an
 * option may come from a `{#for}`, an arm or a component, and every one of them has rendered by
 * now. A single select marks the first match, which is the one assigning `value` selects.
 */
export function selectedMarkup(markup: string, value: unknown): string {
    if (value === undefined || value === null) return markup
    const multiple = Array.isArray(value)
    let out = ''
    let cut = 0
    let marked = false
    for (const match of markup.matchAll(OPTION_TAG)) {
        if (marked && !multiple) break
        const end = (match.index as number) + match[0].length
        const named = VALUE_ATTRIBUTE.exec(match[1] as string)
        let text: string
        if (named !== null)
            text = decoded(named[1] ?? named[2] ?? named[3] ?? '')
        else {
            // The option's text, as the browser reads `value` from it: comments out,
            // whitespace collapsed.
            const rest = markup.slice(end)
            const stop = rest.search(OPTION_TEXT_END)
            text = decoded(
                (stop === -1 ? rest : rest.slice(0, stop)).replace(COMMENT, ''),
            )
                .replace(/\s+/g, ' ')
                .trim()
        }
        if (!selectHolds(value, text)) continue
        out += `${markup.slice(cut, end - 1)} selected>`
        cut = end
        marked = true
    }
    return cut === 0 ? markup : out + markup.slice(cut)
}

function decoded(text: string): string {
    if (!text.includes('&')) return text
    return text.replace(REFERENCE, (whole, decimal, hex, name) =>
        decimal !== undefined
            ? String.fromCodePoint(Number(decimal))
            : hex !== undefined
              ? String.fromCodePoint(Number.parseInt(hex, 16))
              : (NAMED[(name as string).toLowerCase()] ?? whole),
    )
}
