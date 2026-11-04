// WHAT A CALL'S ARGS ARE BEFORE ITS HANDLER SEES THEM, on a server: the schema a handler's args are
// read by, out of the sources it has, and the args a call off the wire is answered with — over http
// (16.2) and a `GET` followed over the socket mux (18.3). Each lane reads the args off its own
// transport and answers a refusal in its own form; what every way of calling a handler shares, in
// process too, is `acceptedArgs` (`#shared/reactive/argsContract.ts`), which this ends in.
//
// 19.7 — A URL CARRIES TEXT, so `?id=42` is `'42'` until the schema says the member is a number.
// Coercion is the pipeline's and not the schema's (19.6): the schema is handed what this made of the
// text, and refuses what would not coerce. A schema with no document has declared no types, and its
// args stay the text they arrived as.

import { DERIVED_ARGS } from '#shared/DERIVED_ARGS.ts'
import { isRecord } from '#shared/isRecord.ts'
import type { JsonValue } from '#shared/JsonValue.ts'
import { numberFromText } from '#shared/numberFromText.ts'
import { bareName } from '#shared/queryText.ts'
import {
    acceptedArgs,
    type Gated,
    gateOf,
    type HeldToAnnotation,
} from '#shared/reactive/argsContract.ts'
import { refuse } from '#shared/refuse.ts'
import { validateJson } from '#shared/validateJson.ts'

import type { Mounted } from './answerRpc.ts'

export type Document = {
    type?: string | string[]
    properties?: Record<string, Document>
    items?: Document
}

// Each handler's document, read once: 19.7, 20.11 — a third-party schema converts itself on every
// probe. 19.9 — the one its annotation derives is filed here by `derivedArgs`.
const DOCUMENTS = new WeakMap<object, Document | undefined>()

const NO_PARAMETERS: Record<string, string | string[]> = {}

/**
 * The document a handler's args are read by: the one its `args` schema declares, or else the one the
 * build derived off its annotation (`derivedArgs`), or `undefined`.
 */
export function argsDocumentOf(handler: Gated<unknown>): Document | undefined {
    if (DOCUMENTS.has(handler)) return DOCUMENTS.get(handler)
    const document = declaredDocument(handler)
    DOCUMENTS.set(handler, document)
    return document
}

function declaredDocument(handler: Gated<unknown>): Document | undefined {
    const gate = gateOf(handler) as
        { '~standard'?: { jsonSchema?: { input?: () => unknown } } } | undefined
    const document = gate?.['~standard']?.jsonSchema?.input?.()
    return document !== null && typeof document === 'object'
        ? (document as Document)
        : undefined
}

/**
 * Holds `handler`'s args to `schema`, the one the build derived off its annotation, for every call
 * of it from now on: in process and over the wire (15.8, 19.9).
 *
 * What the module a handler is loaded through calls once its handler is built — a handler file's
 * face and a `<script server>`'s module — so the schema is there wherever the handler can be
 * called, whether or not an app mounted it. Not where its `args` gate publishes a document of its
 * own, which holds the args itself (19.7). Args that did not come are held as an empty record: a
 * schema is only derived where the handler's args are a required record, so a required member
 * missing is refused, not read off nothing.
 */
export function derivedArgs(
    handler: HeldToAnnotation & Gated<unknown>,
    schema: JsonValue,
): void {
    if (declaredDocument(handler) !== undefined) return
    DOCUMENTS.set(handler, schema as Document)
    handler[DERIVED_ARGS] = (args) => validateJson(schema, args ?? {})
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
 * The args a call over the wire is answered with, out of the args it sent: the parameters its route
 * matched laid in, the text a URL or a form carried coerced where `query` says the args are text,
 * then `acceptedArgs`. Throws the refusal where they are not accepted.
 *
 * `query` is the raw `?…` the args were read from — `''` for a form, `undefined` for JSON.
 * 16.65 — the path's parameters, whatever the method. 16.66 — one the query or the body names as well
 * is refused rather than one of the two chosen. A JSON body's members are typed already, so the
 * path's text is coerced to the declared types before it joins them (19.7); text args are coerced
 * with the rest of the text.
 */
export function argsFor(
    handler: Mounted['handler'],
    sent: unknown,
    query: string | undefined,
    parameters: Record<string, string | string[]> = NO_PARAMETERS,
): unknown {
    const document = argsDocumentOf(handler)
    let args = sent
    let none = true
    for (const name in parameters) {
        none = false
        if (isRecord(sent) && name in sent)
            throw refuse(
                400,
                `The parameter '${name}' is in the path and in the request as well.`,
            )
    }
    if (!none) {
        const fromPath =
            query === undefined
                ? (coerceArgs(parameters, document, '') as Record<
                      string,
                      unknown
                  >)
                : parameters
        args = isRecord(sent) ? { ...sent, ...fromPath } : { ...fromPath }
    }
    if (query !== undefined)
        args = coerceArgs(
            args as Record<string, string | string[]> | undefined,
            document,
            query,
        )
    return acceptedArgs(handler, args)
}

/**
 * The text args, each member coerced to the type `document` declares.
 *
 * `URLSearchParams` reads `rpcRequest`'s empty list, a bare name, as `''` — the same as `tags=`, the
 * list `['']` — so a declared array tells the two apart by `query`. A text member keeps the `''`.
 */
function coerceArgs(
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
