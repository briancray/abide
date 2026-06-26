import type { StandardSchemaV1 } from './StandardSchemaV1.ts'

/*
A verb's declared error set, keyed by error NAME (not status, so two errors can
share a status). Each entry names its HTTP `status` and an optional `data`
schema whose inferred input the error constructor requires. Passed as the verb's
`errors` opt; the client derives a typed `Result` union from it (see
`RpcErrorUnion`), and the handler receives matching constructors (see
`ErrorConstructors`).
*/
export type ErrorSpec = Record<string, { status: number; data?: StandardSchemaV1 }>
