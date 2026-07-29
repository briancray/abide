// The 422 an input-schema failure travels as (rpc-core §9.1, §10.5) — a typed error like any other.
//
// It lives here rather than beside `ValidationErrorData` in `shared/` because a failure's WIRE SHAPE is
// `errorResponse`'s to state, and stating it a second time is exactly what went wrong: this path wrote
// the typed-error name to the body as `kind`, while `errorResponse` — and the browser proxy that decodes
// it — carry it as `name`. So a 422 reached the client with no kind at all and
// `fn.isError(e, 'ValidationError')` was silently false there while narrowing fine in-process. `shared/`
// keeps only what the client genuinely needs: the payload type and its flattener.

import type { StandardSchemaV1 } from '../../shared/StandardSchema.ts'
import { toValidationErrorData } from '../../shared/ValidationErrorData.ts'
import { errorResponse } from './errorResponse.ts'

const VALIDATION_ERROR_KIND = 'ValidationError'
const VALIDATION_ERROR_STATUS = 422

export function validationError(issues: ReadonlyArray<StandardSchemaV1.Issue>): Response {
    return errorResponse(VALIDATION_ERROR_STATUS, undefined, {
        kind: VALIDATION_ERROR_KIND,
        data: toValidationErrorData(issues),
    })
}
