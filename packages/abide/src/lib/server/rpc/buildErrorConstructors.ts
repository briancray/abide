import type { ErrorConstructors } from '../../shared/types/ErrorConstructors.ts'
import type { ErrorSpec } from '../../shared/types/ErrorSpec.ts'

/*
Turns a rpc's declared `ErrorSpec` into the constructor object handed to the
handler (`(args, { errors })`). Each constructor stamps its name + status onto an
`ErrorDescriptor` carrying the call's `data`, which `error()` serializes as the
`{ $abideError, data }` body. Receiver-agnostic on data: a nullary error ignores
the (absent) argument.
*/
export function buildErrorConstructors<Spec extends ErrorSpec>(
    spec: Spec,
): ErrorConstructors<Spec> {
    const entries = Object.entries(spec).map(([name, { status }]) => [
        name,
        (data: unknown) => ({ $abideError: name, status, data }),
    ])
    return Object.fromEntries(entries) as ErrorConstructors<Spec>
}
