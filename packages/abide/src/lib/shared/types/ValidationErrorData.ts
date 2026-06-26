import type { StandardSchemaV1 } from './StandardSchemaV1.ts'

/*
The `data` payload an input/file validation failure carries on its HttpError —
`kind: 'validation'`, status 422. `issues` is the raw Standard Schema issue list
(every message + full path); `fields` is the form-friendly top-level-field →
first-message map (fieldErrorsFromIssues). Because a throw can't carry the rpc's
per-kind type to the catch, `HttpError.data` is typed `unknown` — narrow it with
this when `err.kind === 'validation'`:

  if (err instanceof HttpError && err.kind === 'validation') {
      const { fields } = err.data as ValidationErrorData
      // fields.email === 'Required', …
  }
*/
// @documentation response
export type ValidationErrorData = {
    readonly issues: readonly StandardSchemaV1.Issue[]
    readonly fields: Record<string, string>
}
