import type { HttpVerb } from './types/HttpVerb.ts'

/*
Parses + merges every source of args available for a verb-defined handler:
- body (json or form-encoded, ignored for GET/DELETE/HEAD)
- url query string

When both are present and the body is a plain object, the merge folds the
query in on top so query keys win on collision. A non-object body (array,
primitive, null) skips the merge entirely and is returned as-is — there's
no key on the body to layer the query into, and the framework's args type
is a single bag rather than a `{body, query}` envelope. Returns undefined
when no source contributes any key.
*/
export async function parseArgs(method: HttpVerb, request: Request): Promise<unknown> {
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
    if (method !== 'GET' && method !== 'DELETE' && method !== 'HEAD') {
        const contentType = (request.headers.get('content-type') ?? '').toLowerCase()
        if (contentType.includes('application/json')) {
            const text = await request.text()
            if (text !== '') {
                body = JSON.parse(text)
            }
        } else if (
            contentType.includes('application/x-www-form-urlencoded') ||
            contentType.includes('multipart/form-data')
        ) {
            const form = await request.formData()
            body = Object.fromEntries(form)
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
    const merged = { ...bodyObject, ...Object.fromEntries(url.searchParams) }
    if (Object.keys(merged).length === 0) {
        return undefined
    }
    return merged
}
