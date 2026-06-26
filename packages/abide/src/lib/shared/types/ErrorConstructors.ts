import type { ErrorDescriptor } from './ErrorDescriptor.ts'
import type { ErrorSpec } from './ErrorSpec.ts'
import type { StandardSchemaV1 } from './StandardSchemaV1.ts'

/*
The constructors handed to the handler via its second arg (`(args, { errors })`),
derived from the verb's `ErrorSpec`. An entry with a `data` schema makes its
constructor require that schema's inferred input; an entry without one is nullary.
Each returns a typed `ErrorDescriptor` to pass to `error()`.
*/
export type ErrorConstructors<Spec extends ErrorSpec> = {
    [Name in keyof Spec & string]: Spec[Name]['data'] extends StandardSchemaV1
        ? (
              data: StandardSchemaV1.InferInput<Spec[Name]['data']>,
          ) => ErrorDescriptor<Name, StandardSchemaV1.InferInput<Spec[Name]['data']>>
        : () => ErrorDescriptor<Name, undefined>
}
