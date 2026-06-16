import { carriesBodyArgs } from '../../shared/carriesBodyArgs.ts'
import { HttpError } from '../../shared/HttpError.ts'
import type { HttpVerb } from '../../shared/types/HttpVerb.ts'
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
Parses + merges every source of args available for a verb-defined handler:
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

`maxBodySize` (per-verb, opt-in) bounds the body's actual received bytes
before any parse — see readBodyWithinLimit. Omitted = no abide-level check;
Bun.serve's server-wide maxRequestBodySize is the ceiling.
*/
export async function parseArgs(
    method: HttpVerb,
    request: Request,
    maxBodySize?: number,
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
        const contentType = (bounded.headers.get('content-type') ?? '').toLowerCase()
        try {
            if (contentType.includes('application/json')) {
                const text = await bounded.text()
                if (text !== '') {
                    body = JSON.parse(text)
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
        if (body === undefined) {
            return undefined
        }
        return body
    }

    const bodyObject = (body ?? {}) as Record<string, unknown>
    const merged = { ...Object.fromEntries(url.searchParams), ...bodyObject }
    if (Object.keys(merged).length === 0) {
        return undefined
    }
    return merged
}
