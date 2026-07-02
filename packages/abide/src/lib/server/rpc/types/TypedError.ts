import type { ErrorSpec } from '../../../shared/types/ErrorSpec.ts'

/*
A `Response` branded with the typed error a handler RETURNED — the name it
travels as (`$abideError`) plus its spec entry (`{ status, data? }`). The rpc
helper reads this brand off the handler's inferred return union to build the
function's `Errors` surface, so `rpc.isError(e, 'name')` narrows `.kind` / `.data`
with no `errors:` option to declare.

Unlike `TypedResponse`'s `__body?` (optional, so a bare `new Response()` stays
assignable), the brand here is REQUIRED: it's the discriminant that tells the
helper an error branch from a success branch (the success body is extracted from
the non-error members, the error spec from these). The runtime value is a plain
serialized Response cast to this type — the brand is phantom, never assigned.
*/
export type TypedError<Name extends string, Entry extends ErrorSpec[string]> = Response & {
    readonly __abideError: { name: Name; entry: Entry }
}
