// 47.32 — SQL AS A TAG.
//
// A statement is written once per call site: the strings of a tagged template are one array for as
// long as the module lives, so the array is the key of the statement prepared for it, and every
// value interpolated is a parameter bound to it — never text. An array interpolated is a list of
// them, `(?, ?, ?)`, so a call site is one statement per length of each list it is handed (47.37).
//
// A QUERY AND NOTHING ELSE: a statement tracks nothing, so what reads one is refreshed by the tags it
// declares, refreshed by whoever writes — only a table called is followed by its changes (47.29).

import type { Database, SQLQueryBindings, Statement } from 'bun:sqlite'

/** The tag an opener's `sql` is: rows, typed as the caller says they are. */
export type Sql = <Row = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: (SQLQueryBindings | readonly SQLQueryBindings[])[]
) => Row[]

/** 47.37 — an empty list: a subquery answering no row, which `IN` matches nothing and `NOT IN` all. */
const NO_ROWS = '(SELECT NULL WHERE 0)'

/**
 * 47.32, 47.37 — what each call site's statement is on each `Database`, per the lengths of the lists
 * handed it (`''` where it is handed none).
 */
const PREPARED = new WeakMap<
    TemplateStringsArray,
    WeakMap<Database, Map<string, Statement>>
>()

/** 47.32 — the `sql` tag over the `Database` `acquire` hands back. */
export function sqlOver(acquire: () => Database): Sql {
    return <Row>(
        strings: TemplateStringsArray,
        ...values: (SQLQueryBindings | readonly SQLQueryBindings[])[]
    ): Row[] => {
        const db = acquire()
        let perDatabase = PREPARED.get(strings)
        if (perDatabase === undefined) {
            perDatabase = new WeakMap()
            PREPARED.set(strings, perDatabase)
        }
        let perShape = perDatabase.get(db)
        if (perShape === undefined) {
            perShape = new Map()
            perDatabase.set(db, perShape)
        }
        // The common call is handed no list, and pays one walk of its values to know it.
        let lengths = ''
        for (let at = 0; at < values.length; at += 1) {
            const value = values[at]
            if (Array.isArray(value)) lengths += `${at}:${value.length},`
        }
        let statement = perShape.get(lengths)
        if (statement === undefined) {
            statement = db.prepare(textOf(strings, values))
            perShape.set(lengths, statement)
        }
        const bound =
            lengths === '' ? (values as SQLQueryBindings[]) : flattened(values)
        return statement.all(...bound) as Row[]
    }
}

/** 47.37 — the statement's text: a `?` per value, and a list of them per array. */
function textOf(
    strings: TemplateStringsArray,
    values: readonly (SQLQueryBindings | readonly SQLQueryBindings[])[],
): string {
    let text = strings[0] as string
    for (let at = 0; at < values.length; at += 1) {
        const value = values[at]
        if (!Array.isArray(value)) text += '?'
        else if (value.length === 0) text += NO_ROWS
        else text += `(${new Array(value.length).fill('?').join(', ')})`
        text += strings[at + 1] as string
    }
    return text
}

/** 47.37 — the values bound, each list's spread in its place; a list nested in one is refused. */
function flattened(
    values: readonly (SQLQueryBindings | readonly SQLQueryBindings[])[],
): SQLQueryBindings[] {
    const bound: SQLQueryBindings[] = []
    for (const value of values) {
        if (!Array.isArray(value)) {
            bound.push(value as SQLQueryBindings)
            continue
        }
        for (const each of value as SQLQueryBindings[]) {
            if (Array.isArray(each))
                throw new Error(
                    'abide: sql was handed a list inside a list, which binds as no value. RULEBOOK 47.37.',
                )
            bound.push(each)
        }
    }
    return bound
}
