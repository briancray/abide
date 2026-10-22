import { ASCII_WHITESPACE } from '#shared/ASCII_WHITESPACE.ts'
import { textOf } from '#shared/Raw.ts'
import { WORK } from '#shared/WORK.ts'

/**
 * 32.71 — what a `class={expr}` and the `class:name` directives beside it last wrote, as one
 * group: the attribute's text and tokens, and the directives' conditions in the order `names`
 * gives them.
 *
 * KEYED BY ELEMENT rather than declared by the mount, because a row's `update` writes the same
 * element from a function of its own and both have to read one record.
 */
const owned = new WeakMap<
    Element,
    {
        text: string | undefined
        tokens: ReadonlySet<string>
        conditions: readonly unknown[] | undefined
        names: string[]
    }
>()

// Every record's tokens until its `class` is first written, which replaces the set.
const NO_TOKENS: ReadonlySet<string> = new Set()

/**
 * Writes a `class={expr}` and the `class:name` directives beside it as one group, through
 * `classList`: `plain` is the attribute's value, and `conditions` each directive's, in the order
 * of `names`, its classes space-separated.
 *
 * 32.71 — ONLY ITS OWN CLASSES, and only what moved: the attribute's tokens are re-split only when
 * its text changed, a token it dropped comes off unless a directive holds it, and a directive is
 * written only when its condition flipped, kept on while the attribute holds its class. Every
 * write is guarded by `contains`, so the first run over a served page writes nothing.
 */
export function setClassGroup(
    element: Element,
    names: string,
    plain: unknown,
    conditions: readonly unknown[],
): void {
    WORK.bindingRuns += 1
    let held = owned.get(element)
    if (held === undefined) {
        held = {
            text: undefined,
            tokens: NO_TOKENS,
            conditions: undefined,
            names: names.split(' '),
        }
        owned.set(element, held)
    }
    const classes = element.classList
    const text = textOf(plain)
    const was = held.conditions
    if (text !== held.text) {
        const next = new Set<string>()
        for (const token of text.split(ASCII_WHITESPACE))
            if (token !== '') next.add(token)
        for (const token of held.tokens) {
            if (next.has(token)) continue
            const at = held.names.indexOf(token)
            if (at !== -1 && conditions[at]) continue
            if (classes.contains(token)) classes.remove(token)
        }
        for (const token of next)
            if (!classes.contains(token)) classes.add(token)
        held.text = text
        held.tokens = next
    }
    for (let at = 0; at < held.names.length; at += 1) {
        const on = Boolean(conditions[at])
        if (was !== undefined && Boolean(was[at]) === on) continue
        const name = held.names[at] as string
        const wanted = on || held.tokens.has(name)
        if (classes.contains(name) !== wanted) classes.toggle(name, wanted)
    }
    held.conditions = conditions
}
