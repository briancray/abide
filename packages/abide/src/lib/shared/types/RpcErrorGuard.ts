import type { HttpError } from '../HttpError.ts'
import type { ErrorSpec } from './ErrorSpec.ts'
import type { OutboxEntry } from './OutboxEntry.ts'
import type { StandardSchemaV1 } from './StandardSchemaV1.ts'
import type { ValidationErrorData } from './ValidationErrorData.ts'

/* The payload a declared error name carries: its data schema's inferred input, or
   `unknown` for a nullary error (no data schema). */
type DeclaredErrorData<
    Errors extends ErrorSpec,
    Name extends keyof Errors,
> = Errors[Name]['data'] extends StandardSchemaV1
    ? StandardSchemaV1.InferInput<Errors[Name]['data']>
    : unknown

/*
A rpc's `isError` guard — branch a caught error on a kind THIS rpc knows, with the
data type narrowed from the rpc's own `errors` spec. `rpc.isError(err, 'outOfStock')`
narrows `.data` to that error's payload; the framework-reserved `'validation'` /
`'queued'` to their fixed shapes; any other string narrows `.kind` only (`.data`
stays `unknown` — it belongs to a different rpc, whose type isn't in scope here).

The declared-name overload comes first so an app error shadows the reserved ones on a
name collision, and so the kind argument autocompletes to the rpc's declared names.
*/
export interface RpcErrorGuard<Errors extends ErrorSpec> {
    <Name extends keyof Errors & string>(
        error: unknown,
        kind: Name,
    ): error is HttpError & { kind: Name; data: DeclaredErrorData<Errors, Name> }
    (
        error: unknown,
        kind: 'validation',
    ): error is HttpError & { kind: 'validation'; data: ValidationErrorData }
    (
        error: unknown,
        kind: 'queued',
    ): error is HttpError & { kind: 'queued'; data: OutboxEntry<unknown> }
    <Kind extends string>(error: unknown, kind: Kind): error is HttpError & { kind: Kind }
}
