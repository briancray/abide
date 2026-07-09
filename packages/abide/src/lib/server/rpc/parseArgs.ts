import { carriesBodyArgs } from '../../shared/carriesBodyArgs.ts'
import { contentTypeOf } from '../../shared/contentTypeOf.ts'
import { decodeRefJson } from '../../shared/decodeRefJson.ts'
import { HttpError } from '../../shared/HttpError.ts'
import { REF_JSON_HEADER } from '../../shared/REF_JSON_HEADER.ts'
import type { HttpMethod } from '../../shared/types/HttpMethod.ts'
import type { InputCoercion } from '../../shared/types/InputCoercion.ts'
import type { WireKind } from '../../shared/types/WireKind.ts'
import { error } from '../error.ts'
import { requestContext } from '../runtime/requestContext.ts'
import { readBodyWithinLimit } from './readBodyWithinLimit.ts'

/*
Splits a parsed FormData into the text fields that become args and the File
parts that don't. Repeated text keys collapse into an array (an HTML form posts
multiple same-named inputs); File parts group by field name and stash on the
request store for files() to read — they never enter args, so the input schema
keeps validating a plain object with no binary in it.
*/
function splitFormData(form: FormData): Record<string, unknown> {
    const fileMap: Record<string, File[]> = {}
    const fields: Record<string, unknown> = {}
    for (const [key, value] of form) {
        if (value instanceof File) {
            fileMap[key] ??= []
            fileMap[key].push(value)
            continue
        }
        const existing = fields[key]
        if (!(key in fields)) {
            fields[key] = value
        } else if (Array.isArray(existing)) {
            existing.push(value)
        } else {
            fields[key] = [existing, value]
        }
    }
    const store = requestContext.getStore()
    if (store && Object.keys(fileMap).length > 0) {
        store.files = fileMap
    }
    return fields
}

/*
Parses + merges every source of args available for a rpc-defined handler:
- body (json or form-encoded, ignored for GET/DELETE/HEAD)
- url query string

When both are present and the body is a plain object, the merge layers the
body on top of the query so the typed body wins on collision — the query
supplies defaults a body field can override, and a URL param can't silently
shadow a validated body value. A non-object body (array, primitive, null)
skips the merge entirely and is returned as-is — there's no key on the body
to layer the query into, and the framework's args type is a single bag rather
than a `{body, query}` envelope. Returns undefined when no source contributes
any key.

`maxBodySize` (per-rpc, opt-in) bounds the body's actual received bytes
before any parse — see readBodyWithinLimit. Omitted = no abide-level check;
Bun.serve's server-wide maxRequestBodySize is the ceiling.
*/
export async function parseArgs(
    method: HttpMethod,
    request: Request,
    maxBodySize?: number,
    coerce?: InputCoercion,
): Promise<unknown> {
    /*
    Skip the URL parse entirely when the raw request URL has no query —
    typical POST/PUT/PATCH calls land here with a flat rpc URL and no
    `?…`, so the `new URL(...)` constructor cost (which dwarfs the
    indexOf check) is wasted work.
    */
    const queryStart = request.url.indexOf('?')
    const hasQuery = queryStart !== -1
    const url = hasQuery ? new URL(request.url) : undefined

    let body: unknown
    if (carriesBodyArgs(method)) {
        let bounded = request
        if (maxBodySize !== undefined) {
            bounded = await readBodyWithinLimit(request, maxBodySize)
            /*
            The size check drained the original body, so point the scope's
            request at the readable copy — a handler with a content-type this
            parse skips (raw uploads) reads the body via request() itself, and
            it must see the bytes, not 'Body already used'.
            */
            const store = requestContext.getStore()
            if (store) {
                store.req = bounded
            }
        }
        const contentType = contentTypeOf(bounded.headers)
        try {
            if (contentType.includes('application/json')) {
                const text = await bounded.text()
                if (text !== '') {
                    /* abide's own client flags ref-json with REF_JSON_HEADER (restores
                       cycles/shared refs JSON can't carry); a non-abide client (curl, an
                       OpenAPI SDK) omits it and sends ordinary JSON — read with plain
                       JSON.parse, since the ref-json envelope is ambiguous with a 2-element
                       array body. */
                    body = bounded.headers.has(REF_JSON_HEADER)
                        ? decodeRefJson(text)
                        : JSON.parse(text)
                }
            } else if (
                contentType.includes('application/x-www-form-urlencoded') ||
                contentType.includes('multipart/form-data')
            ) {
                body = splitFormData(await bounded.formData())
            }
        } catch {
            /* A malformed body is the client's fault — surface a 400, not the 500 a
               raw JSON.parse/formData throw would bubble to. createRemoteFunction.fetch
               unwraps the HttpError's response onto the wire (as it does for the 413). */
            throw new HttpError(error(400, 'Malformed request body'))
        }
    }

    if (body !== undefined && (typeof body !== 'object' || body === null || Array.isArray(body))) {
        return body
    }

    if (!url) {
        /* `body` is undefined or a plain object here. A form-encoded body arrives stringly, so
           coerce its numeric/boolean fields (a JSON body's values are already typed — non-strings
           the coercion leaves untouched). */
        if (body !== undefined && coerce !== undefined) {
            applyCoercion(body as Record<string, unknown>, coerce)
        }
        return body
    }

    /*
    Query params (and form-encoded body fields) arrive as strings, so a numeric/boolean field
    would reach schema validation as `'2'`/`'true'`. `coerce` (ADR-0028) is the build-time plan
    of exactly which fields are numeric/boolean in the endpoint's `Args` type — resolved through
    the warm server program, so a string-typed field that merely looks numeric (an id, a zip code,
    `'1.0'`) is never listed and stays a string. Applied to the merged bag below; a JSON body's
    already-typed values are non-strings the coercion skips.
    */
    const bodyObject = (body ?? {}) as Record<string, unknown>
    /* Collect the query into an object, arraying repeated keys (`?tag=a&tag=b` → `['a','b']`)
       rather than letting `Object.fromEntries` silently keep only the last — mirrors
       splitFormData, so a repeated field reaches the schema as an array, not a dropped value. */
    const queryObject: Record<string, unknown> = {}
    for (const [key, value] of url.searchParams) {
        const existing = queryObject[key]
        if (!(key in queryObject)) {
            queryObject[key] = value
        } else if (Array.isArray(existing)) {
            existing.push(value)
        } else {
            queryObject[key] = [existing, value]
        }
    }
    const merged = { ...queryObject, ...bodyObject }
    if (Object.keys(merged).length === 0) {
        return undefined
    }
    if (coerce !== undefined) {
        applyCoercion(merged, coerce)
    }
    return merged
}

/*
Revives the plain-JSON wire values in `args` into the runtime types the plan declares, in place
(ADR-0028 scalars, ADR-0029 structured). The scalar kinds (number/boolean/date/bigint) touch
strings only — a value the merge layered in from a typed JSON body is already the right type and
left alone; a repeated key (`?tag=1&tag=2`) is an array whose string members revive per element.
The container kinds (set/map) build from a JSON array (or object) but pass an already-typed value
(from the abide client's ref-json body) through untouched. Every branch is fail-open: an
unrevivable value stays its JSON form so the schema surfaces an honest issue rather than a throw.
*/
function applyCoercion(args: Record<string, unknown>, coerce: InputCoercion): void {
    for (const key in coerce) {
        if (!(key in args)) {
            continue
        }
        args[key] = reviveValue(args[key], coerce[key])
    }
}

/* One field's wire value → its runtime type per `kind`, fail-open. The container kinds wrap a JSON
   array/object; the scalar kinds revive a string (or each string in a repeated-key array). An
   already-typed value (Set/Map/Date/bigint from the abide ref-json body) passes through. */
function reviveValue(value: unknown, kind: WireKind): unknown {
    if (kind === 'set') {
        if (value instanceof Set) {
            return value
        }
        /* Top-level only: array MEMBERS are not descended into (ADR-0029 defers nesting). */
        return Array.isArray(value) ? new Set(value) : value
    }
    if (kind === 'map') {
        if (value instanceof Map) {
            return value
        }
        /* A JSON array of `[key, value]` entries, or a plain object's own entries. */
        if (Array.isArray(value)) {
            return new Map(value as [unknown, unknown][])
        }
        if (value !== null && typeof value === 'object') {
            return new Map(Object.entries(value))
        }
        return value
    }
    if (typeof value === 'string') {
        return reviveScalar(value, kind)
    }
    if (Array.isArray(value)) {
        return value.map((element) =>
            typeof element === 'string' ? reviveScalar(element, kind) : element,
        )
    }
    return value
}

/* One string → its number/boolean/date/bigint value, or the original string when it doesn't parse
   cleanly (empty/whitespace, `NaN`, a non-`true`/`false` boolean, an unparseable date, a
   non-integer bigint), so a bad value fails validation with the field intact instead of coercing
   to `0`/`NaN`/`Invalid Date`. */
function reviveScalar(value: string, kind: WireKind): unknown {
    if (kind === 'number') {
        if (value.trim() === '') {
            return value
        }
        const parsed = Number(value)
        return Number.isNaN(parsed) ? value : parsed
    }
    if (kind === 'boolean') {
        if (value === 'true') {
            return true
        }
        if (value === 'false') {
            return false
        }
        return value
    }
    if (kind === 'date') {
        const date = new Date(value)
        return Number.isNaN(date.getTime()) ? value : date
    }
    if (kind === 'bigint') {
        if (value.trim() === '') {
            return value
        }
        try {
            return BigInt(value)
        } catch {
            /* A non-integer / malformed literal throws — keep the string for the schema to reject. */
            return value
        }
    }
    return value
}
