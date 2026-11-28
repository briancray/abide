// 47.34 — A LIST BOUND IN A STATEMENT. A short list is a `?` per value, its slots rounded up to a power
// of two and the last value repeated into the rest — `IN` reads a repeat as nothing new — so one call
// site prepares at most one statement per power of two rather than one per length. A long list is ONE
// value, its JSON, read back by `json_each`: one statement whatever its length, and never past the
// count of values SQLite binds to one statement.

import type { SQLQueryBindings } from 'bun:sqlite'

/** The longest list bound a `?` per value; a longer one is bound as its JSON. */
const SLOTTED_AT_MOST = 1024

/** 47.34 — an empty list: a subquery answering no row, which `IN` matches nothing and `NOT IN` all. */
const NO_ROWS = '(SELECT NULL WHERE 0)'

const AS_JSON = '(SELECT value FROM json_each(?))'

/** The slots a list of `length` takes: 0 for none, `-1` for one JSON value, else a power of two. */
export function slotsOf(length: number): number {
    if (length === 0) return 0
    if (length > SLOTTED_AT_MOST) return -1
    let slots = 1
    while (slots < length) slots *= 2
    return slots
}

/** The text a list of `slots` stands for in a statement. */
export function listText(slots: number): string {
    if (slots === 0) return NO_ROWS
    if (slots === -1) return AS_JSON
    return `(${new Array(slots).fill('?').join(', ')})`
}

/**
 * The values a list binds, pushed onto `bound`: each, then its last repeated to fill its slots; or
 * one JSON array. A list nested in one, or a value JSON cannot carry, is refused.
 */
export function bindList(
    list: readonly unknown[],
    slots: number,
    bound: SQLQueryBindings[],
    refuse: (reason: string) => never,
): void {
    if (slots === -1) {
        bound.push(jsonOf(list, refuse))
        return
    }
    for (const each of list) {
        if (Array.isArray(each))
            refuse('a list inside a list, which binds as no value')
        bound.push(each as SQLQueryBindings)
    }
    const last = list[list.length - 1] as SQLQueryBindings
    for (let at = list.length; at < slots; at += 1) bound.push(last)
}

/** A long list as the JSON array `json_each` reads: booleans as SQLite's 1 and 0, bigints exactly. */
function jsonOf(
    list: readonly unknown[],
    refuse: (reason: string) => never,
): string {
    let text = '['
    for (let at = 0; at < list.length; at += 1) {
        const each = list[at]
        if (at > 0) text += ','
        if (each === null) text += 'null'
        else if (typeof each === 'string') text += JSON.stringify(each)
        else if (typeof each === 'number' && Number.isFinite(each))
            text += String(each)
        else if (typeof each === 'bigint') text += each.toString()
        else if (typeof each === 'boolean') text += each ? '1' : '0'
        else if (Array.isArray(each))
            refuse('a list inside a list, which binds as no value')
        else
            refuse(
                `a list of more than ${SLOTTED_AT_MOST} holding ${Bun.inspect(each)}, which JSON cannot carry`,
            )
    }
    return `${text}]`
}
