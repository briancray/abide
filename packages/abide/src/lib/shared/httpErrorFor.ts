import { contentBodyKind } from './contentBodyKind.ts'
import { contentTypeOf } from './contentTypeOf.ts'
import { HttpError } from './HttpError.ts'

/*
Builds the HttpError for a non-2xx response, parsing a typed-error body
(`{ $abideError, data }`, emitted by an `error.typed(...)` constructor and validation 422)
onto `.kind` / `.data`. Reads a clone so the original `response.body` stays
unread for callers that inspect it. A non-JSON or malformed body leaves
`.kind` / `.data` undefined (a plain `error(status, text)`). Shared by the
plain decode path (decodeResponse) and the streaming path (streamResponse) so
both surface the same typed error on a non-2xx.
*/
export async function httpErrorFor(response: Response): Promise<HttpError> {
    if (contentBodyKind(contentTypeOf(response.headers)) === 'json') {
        try {
            const body = await response.clone().json()
            if (body !== null && typeof body === 'object' && '$abideError' in body) {
                return new HttpError(response, body.$abideError, body.data)
            }
        } catch {
            /* malformed JSON error body — fall through to a plain HttpError */
        }
    }
    return new HttpError(response)
}
