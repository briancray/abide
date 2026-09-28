// 19.8 — A `GET` OR `DELETE`'s TEXT ARGS, COERCED FROM THE TYPE THE `JsonSchema` DECLARES, before
// anything validates them. A URL carries text, so `?id=42` is `'42'` until the schema says the member
// is a number. Coercion is the pipeline's and not the schema's (19.7): the schema is handed what this
// made of the text, and refuses what would not coerce.
//
// Read off a `Schema` built by `jsonSchema`, where the document is exposed; a schema with no document
// has declared no types, and its args stay the text they arrived as.

import { numberFromText } from '#shared/numberFromText.ts'
import { ARGS_GATE } from '#shared/reactive/ARGS_GATE.ts'
import type { Gated } from '#shared/reactive/Keyed.ts'
import { bareName } from '#shared/rpcRequest.ts'

export type Document = {
    type?: string | string[]
    properties?: Record<string, Document>
    items?: Document
}

// The document a handler's `args` schema declares, or `undefined`.
export function argsDocumentOf(handler: Gated<unknown>): Document | undefined {
    const gate = handler[ARGS_GATE] as
        | { '~standard'?: { jsonSchema?: { input?: () => unknown } } }
        | undefined
    const document = gate?.['~standard']?.jsonSchema?.input?.()
    return document !== null && typeof document === 'object'
        ? (document as Document)
        : undefined
}

// `query` is the raw `?…` the args were read from: `URLSearchParams` reads `rpcRequest`'s empty list,
// a bare name, as `''` — the same as `tags=`, the list `['']` — so a declared array tells the two
// apart there. A text member keeps the `''`.
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

// The first declared type the text reads as, in the order the schema lists them — text that reads as
// none stays text, for the schema to refuse.
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
