// 47.29 — SQL AS A TAG.
//
// A statement is written once per call site: the strings of a tagged template are one array for as
// long as the module lives, so the array is the key of the statement prepared for it, and every
// value interpolated is a parameter bound to it — never text. An array interpolated is a list of
// them (47.34), its slots rounded so a call site prepares one statement per power of two of each
// list's length, and a long list one value whatever its length (`boundList`).
//
// 47.38 — A ROW READ AS ITS COLUMNS ARE DECLARED: a column the statement reads straight from a table
// declared `BOOLEAN` or `JSON` is decoded, and a statement reading none such pays nothing for it.
//
// A QUERY AND NOTHING ELSE: a statement tracks nothing, as a table called tracks nothing (47.48), so
// what reads one is refreshed by the tags it declares, refreshed by whoever writes.

import type { Database, SQLQueryBindings, Statement } from 'bun:sqlite'

import { isPlainData } from '#shared/isPlainData.ts'

import { bindList, listText, slotsOf } from './boundList.ts'
import { codecOf, type CodedColumn, decodeRows } from './columnCodec.ts'

/** The tag an opener's `sql` is: rows, typed as the caller says they are. */
export type Sql = <Row = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: SqlValue[]
) => Row[]

/** 47.29, 47.34, 47.50 — what `sql` binds: a value, a list of them, or a plain object as its JSON. */
type SqlValue =
    | SQLQueryBindings
    | readonly SQLQueryBindings[]
    // An interface carries no index signature, so a record type would refuse one; `object` admits it.
    | object

/** A call site's statement, and the columns of its rows it decodes. */
type Prepared = { statement: Statement; coded: CodedColumn[] }

/**
 * 47.29, 47.34 — what each call site's statement is on each `Database`, per the slots of the lists
 * handed it (`''` where it is handed none).
 */
const PREPARED = new WeakMap<
    TemplateStringsArray,
    WeakMap<Database, Map<string, Prepared>>
>()

/** 47.29 — the `sql` tag over the `Database` `acquire` hands back. */
export function sqlOver(acquire: () => Database): Sql {
    return <Row>(
        strings: TemplateStringsArray,
        ...values: SqlValue[]
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
        let shape = ''
        for (let at = 0; at < values.length; at += 1) {
            const value = values[at]
            if (Array.isArray(value)) shape += `${at}:${slotsOf(value.length)},`
            // 47.50 — a plain object is bound as its JSON text.
            else if (isPlainData(value)) shape += `${at}:json,`
        }
        let prepared = perShape.get(shape)
        if (prepared === undefined) {
            const statement = db.prepare(textOf(strings, values))
            prepared = { statement, coded: codedOf(statement) }
            perShape.set(shape, prepared)
        }
        const bound =
            shape === '' ? (values as SQLQueryBindings[]) : flattened(values)
        return decodeRows(
            prepared.statement.all(...bound) as Row[],
            prepared.coded,
        )
    }
}

/** 47.38 — the columns a statement reads straight from a column declared `BOOLEAN` or `JSON`. */
function codedOf(statement: Statement): CodedColumn[] {
    const coded: CodedColumn[] = []
    const names = statement.columnNames
    const declared = statement.declaredTypes
    for (let at = 0; at < names.length; at += 1) {
        const codec = codecOf(declared[at])
        if (codec !== undefined)
            coded.push({ column: names[at] as string, codec })
    }
    return coded
}

/** 47.34 — the statement's text: a `?` per value, and a list's slots per array. */
function textOf(
    strings: TemplateStringsArray,
    values: readonly SqlValue[],
): string {
    let text = strings[0] as string
    for (let at = 0; at < values.length; at += 1) {
        const value = values[at]
        text += Array.isArray(value) ? listText(slotsOf(value.length)) : '?'
        text += strings[at + 1] as string
    }
    return text
}

/** 47.34, 47.50 — the values bound: each list's in its place, a plain object as its JSON. */
function flattened(values: readonly SqlValue[]): SQLQueryBindings[] {
    const bound: SQLQueryBindings[] = []
    for (const value of values) {
        if (Array.isArray(value))
            bindList(value, slotsOf(value.length), bound, refused)
        else if (isPlainData(value)) bound.push(JSON.stringify(value))
        else bound.push(value as SQLQueryBindings)
    }
    return bound
}

function refused(reason: string): never {
    throw new Error(`abide: sql was handed ${reason}. RULEBOOK 47.34.`)
}
