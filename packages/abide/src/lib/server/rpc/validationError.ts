import { fieldErrorsFromIssues } from '../../shared/fieldErrorsFromIssues.ts'
import type { StandardSchemaV1 } from '../../shared/types/StandardSchemaV1.ts'
import type { ValidationErrorData } from '../../shared/types/ValidationErrorData.ts'
import { typedErrorResponse } from '../runtime/typedErrorResponse.ts'

/*
The framework-reserved `validation` typed error a 422 carries: the raw Standard
Schema `issues` plus the form-friendly field → first-message map. Routed through
the shared `typedErrorResponse` serializer so it emits the same
`{ $abideError, data }` body every typed error uses, and so the 422's reason
phrase reaches `HttpError.statusText`. The client parses it back onto
`HttpError.kind = 'validation'` / `.data: ValidationErrorData`.
*/
export function validationError(issues: readonly StandardSchemaV1.Issue[]): Response {
    const data: ValidationErrorData = { issues, fields: fieldErrorsFromIssues(issues) }
    return typedErrorResponse('validation', 422, data)
}
