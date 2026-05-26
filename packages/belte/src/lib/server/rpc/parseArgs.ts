import type { HttpVerb } from './types/HttpVerb.ts'

/*
Parses + merges every source of args available for a verb-defined handler:
- body (json or form-encoded, ignored for GET/DELETE)
- url query string

Query keys win on collision. Returns undefined when no source contributes
any key. A non-object body (array, primitive) is returned as-is and no
merge runs — the query has nowhere to go in that case.
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
    if (method !== 'GET' && method !== 'DELETE') {
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
