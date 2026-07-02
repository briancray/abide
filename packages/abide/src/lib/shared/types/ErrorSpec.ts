import type { StandardSchemaV1 } from './StandardSchemaV1.ts'

/*
A rpc's error set, keyed by error NAME (not status, so two errors can share a
status). Each entry names its HTTP `status` and an optional `data` schema whose
inferred input the error constructor requires. Built at the type level from the
`error.typed(...)` constructors a handler RETURNS (see `TypedError` +
`InferredErrors` in RpcHelper); the client's `rpc.isError` narrows `.kind` /
`.data` off it (see `RpcErrorGuard`).
*/
export type ErrorSpec = Record<string, { status: number; data?: StandardSchemaV1 }>
