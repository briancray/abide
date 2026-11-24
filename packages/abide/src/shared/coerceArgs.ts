// TEXT AS ARGS: what a form or a query carries, every member a string or a list of them, made into the
// args a handler's schema reads — a name given more than once a list, and each member coerced to the
// type the schema's document declares (19.7). One reading on both sides, so a `form` checks in the
// browser exactly the args a server would have read off the same fields posted (19.28).

import { isRecord } from './isRecord.ts'
import { numberFromText } from './numberFromText.ts'
import { parsedJson } from './parsedJson.ts'
import { bareName } from './queryText.ts'

/** The part of a JSON Schema document coercion reads: each member's declared types. */
export type Document = {
    type?: string | string[]
    properties?: Record<string, Document>
    items?: Document
}

/**
 * Name and value pairs as args: a name given more than once is a list, one given once its text.
 *
 * 16.18 — a query's and a form's members, and 38.61 — `abide call`'s `name=value` words, alike.
 */
export function collapsed(
    entries: URLSearchParams | FormData,
): Record<string, string | string[]> {
    const args: Record<string, string | string[]> = {}
    for (const name of new Set(entries.keys())) {
        const values = entries.getAll(name) as string[]
        args[name] = values.length === 1 ? (values[0] as string) : values
    }
    return args
}

/**
 * The text args, each member coerced to the type `document` declares.
 *
 * `URLSearchParams` reads `rpcRequest`'s empty list, a bare name, as `''` — the same as `tags=`, the
 * list `['']` — so a declared array tells the two apart by `query`. A text member keeps the `''`.
 */
export function coerceArgs(
    args: Record<string, string | string[]> | undefined,
    document: Document | undefined,
    query: string,
): unknown {
    if (args === undefined || document?.properties === undefined) return args
    const coerced: Record<string, unknown> = {}
    for (const [name, text] of Object.entries(args)) {
        const member = document.properties[name]
        if (member === undefined) coerced[name] = text
        else if (
            text === '' &&
            typesOf(member).includes('array') &&
            `&${query.slice(1)}&`.includes(`&${bareName(name)}&`)
        )
            coerced[name] = []
        else coerced[name] = coerceMember(text, member)
    }
    return coerced
}

function typesOf(member: Document): string[] {
    if (member.type === undefined) return []
    return Array.isArray(member.type) ? member.type : [member.type]
}

function coerceMember(text: string | string[], member: Document): unknown {
    const types = typesOf(member)
    // 19.27 — a record, or a list of records or lists, came as one JSON text (30.28).
    if (typeof text === 'string') {
        if (types.includes('object')) {
            const parsed = parsedJson(text)
            if (isRecord(parsed)) return parsed
        }
        // A list whose items are undeclared came as JSON only where it held a structure.
        const undeclared = member.items === undefined
        if (types.includes('array') && (undeclared || holdsStructure(member))) {
            const parsed = parsedJson(text)
            if (
                Array.isArray(parsed) &&
                (!undeclared || parsed.some(isStructure))
            )
                return parsed
        }
    }
    // A list is its member repeated, and one given once still answers a declared array.
    if (types.includes('array')) {
        const items = Array.isArray(text) ? text : [text]
        const item = member.items
        return item === undefined
            ? items
            : items.map((each) => coerceScalar(each, item))
    }
    if (Array.isArray(text)) return text
    return coerceScalar(text, member)
}

/** Whether a declared list holds records or lists, and so came as one JSON text rather than repeated. */
function holdsStructure(member: Document): boolean {
    const types = typesOf(member.items as Document)
    return types.includes('object') || types.includes('array')
}

/** Whether a list's element made the list one JSON text: a record or a list. */
function isStructure(element: unknown): boolean {
    return Array.isArray(element) || isRecord(element)
}

/**
 * The text as the first declared type it reads as, in the order the schema lists them.
 *
 * Text that reads as none stays text, for the schema to refuse.
 */
function coerceScalar(text: string, member: Document): unknown {
    for (const type of typesOf(member)) {
        if (type === 'string') return text
        if (type === 'number' || type === 'integer') {
            const number = numberFromText(text)
            if (number !== undefined) return number
        }
        if (type === 'boolean' && (text === 'true' || text === 'false'))
            return text === 'true'
        if (type === 'null' && text === 'null') return null
    }
    return text
}
