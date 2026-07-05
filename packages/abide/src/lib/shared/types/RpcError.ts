import type { HttpError } from '../HttpError.ts'
import type { ErrorSpec } from './ErrorSpec.ts'
import type { StandardSchemaV1 } from './StandardSchemaV1.ts'

/* Payload a declared error name carries: its data schema's inferred input, or `unknown`
   for a nullary error (no data schema) — mirrors RpcErrorGuard's DeclaredErrorData. */
type DeclaredData<
    Errors extends ErrorSpec,
    Name extends keyof Errors,
> = Errors[Name]['data'] extends StandardSchemaV1
    ? StandardSchemaV1.InferInput<Errors[Name]['data']>
    : unknown

/*
The typed error value `fn.error()` returns: the discriminated union of this rpc's declared
errors (name → data), each an HttpError narrowed on `.kind` / `.data`. The read-side mirror
of RpcErrorGuard's narrowing, as a value rather than a guard — so `getUser.error()?.name`
is already narrowed with no guard call. `never` (collapses to `undefined`-only at the call
site) for an rpc that declares no errors.
*/
export type RpcError<Errors extends ErrorSpec> = {
    [Name in keyof Errors & string]: HttpError & {
        kind: Name
        data: DeclaredData<Errors, Name>
    }
}[keyof Errors & string]
