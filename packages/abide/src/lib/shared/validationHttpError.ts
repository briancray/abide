import { fieldErrorsFromIssues } from './fieldErrorsFromIssues.ts'
import { HttpError } from './HttpError.ts'
import type { StandardSchemaV1 } from './types/StandardSchemaV1.ts'
import type { ValidationErrorData } from './types/ValidationErrorData.ts'

/*
Builds the HttpError a client-side pre-flight validation failure throws (ADR-0026 D2),
shaped IDENTICALLY to the one a caller gets when the server rejects the same input with a
422: `kind: 'validation'`, `status: 422`, `data: ValidationErrorData` (`{ issues, fields }`),
so an `error instanceof HttpError && error.kind === 'validation'` branch — and the
`error.data.fields` form-error map — read the same whether the rejection came from the
client pre-flight or the server.

This is a UX optimization ONLY, never a trust boundary: the server's unconditional
`inputSchema['~standard'].validate` → `validationError` 422 (defineRpc.ts) stays
authoritative. A client that skips or fakes this check is still fully validated on the
server.

The `data` mapping (`fieldErrorsFromIssues`) is the same isomorphic helper the server 422
uses; the response envelope (`{ $abideError, data }`, status 422, reason phrase) mirrors
`typedErrorResponse('validation', 422, …)` — reconstructed here with a plain web-standard
`Response` so the browser bundle never imports the server's Response builder. The status
text mirrors `STATUS_TEXT[422]`.
*/
export function validationHttpError(issues: readonly StandardSchemaV1.Issue[]): HttpError {
    const data: ValidationErrorData = { issues, fields: fieldErrorsFromIssues(issues) }
    const response = new Response(JSON.stringify({ $abideError: 'validation', data }), {
        status: 422,
        statusText: 'Unprocessable Content',
        headers: { 'content-type': 'application/json' },
    })
    return new HttpError(response, 'validation', data)
}
