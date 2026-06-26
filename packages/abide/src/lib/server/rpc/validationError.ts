import type { StandardSchemaV1 } from '../../shared/types/StandardSchemaV1.ts'
import type { ValidationErrorData } from '../../shared/types/ValidationErrorData.ts'
import { error } from '../error.ts'
import { fieldErrorsFromIssues } from './fieldErrorsFromIssues.ts'

/*
The framework-reserved `validation` typed error a 422 carries: the raw Standard
Schema `issues` plus the form-friendly field → first-message map. Routed through
the single `error()` funnel (descriptor form) so it serializes as the same
`{ $abideError, data }` body every typed error uses, and so the 422's reason
phrase reaches `HttpError.statusText`. The client parses it back onto
`HttpError.kind = 'validation'` / `.data: ValidationErrorData`.
*/
export function validationError(issues: readonly StandardSchemaV1.Issue[]): Response {
    const data: ValidationErrorData = { issues, fields: fieldErrorsFromIssues(issues) }
    return error({ $abideError: 'validation', status: 422, data })
}
