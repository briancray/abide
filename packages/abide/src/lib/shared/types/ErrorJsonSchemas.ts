/*
Status-keyed map of a handler's typed-error data schemas (ADR-0030), baked at build time from the
handler's `error.typed(name, status, schema?)` return branches. Each key is an HTTP status, each
value the error's `data` type projected to JSON Schema (multiple errors sharing a status combine
under `anyOf`; a nullary error with no data contributes a bare `{}`). Feeds the OpenAPI
`responses[status]` surface — the error-branch sibling of the success `outputJsonSchema`.
*/
export type ErrorJsonSchemas = Record<number, Record<string, unknown>>
