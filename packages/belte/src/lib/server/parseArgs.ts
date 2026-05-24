import type { HttpVerb } from '../types/HttpVerb.ts'

/*
Parses + merges every source of args available for a verb-defined handler:
- body (json or form-encoded, ignored for GET/DELETE)
- url query string
- path params from the matched Bun.serve route

Later sources win on key collision; path params are most authoritative since
they came straight off the URL. Returns undefined when no source contributes
any key. A non-object body (array, primitive) is returned as-is and no merge
runs — path/query have nowhere to go in that case.
*/
export async function parseArgs(
    method: HttpVerb,
    request: Request,
    pathParams?: Record<string, string>,
): Promise<unknown> {
    const url = new URL(request.url)
    const query = Object.fromEntries(url.searchParams)

    let body: unknown = undefined
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

    const bodyObject = (body ?? {}) as Record<string, unknown>
    const merged = { ...bodyObject, ...query, ...(pathParams ?? {}) }
    if (Object.keys(merged).length === 0) {
        return undefined
    }
    return merged
}
