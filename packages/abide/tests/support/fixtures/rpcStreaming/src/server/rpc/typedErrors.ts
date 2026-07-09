import { error } from '@abide/abide/server/error'
import { GET } from '@abide/abide/server/GET'
import { json } from '@abide/abide/server/json'

/* Minimal Standard Schema shape — the fixtures carry no schema library, so the `~standard.types`
   phantom (which `error.typed` reads the data type off) is declared directly. */
type StandardSchema<Input> = {
    readonly '~standard': {
        readonly version: 1
        readonly vendor: string
        readonly validate: (value: unknown) => { value: Input }
        readonly types?: { readonly input: Input; readonly output: Input }
    }
}

const schemaOf = <Input>(): StandardSchema<Input> => ({
    '~standard': {
        version: 1,
        vendor: 'fixture',
        validate: (value) => ({ value: value as Input }),
    },
})

const missingSchema = schemaOf<{ id: string }>()
const conflictSchema = schemaOf<{ existingId: number }>()
const goneSchema = schemaOf<{ movedTo: string }>()

const notFound = error.typed('notFound', 404, missingSchema)
const conflict = error.typed('conflict', 409, conflictSchema)
/* Shares status 404 with `notFound` but with a DISTINCT data schema — the error query must combine
   the two 404 data schemas under `anyOf`. */
const gone = error.typed('gone', 404, goneSchema)
/* Nullary typed error (no data schema) — its response has no `data` payload. */
const rateLimited = error.typed('rateLimited', 429)

/* A handler whose return union is one success branch (`json`) plus four typed-error branches; two
   share status 404 to exercise the `anyOf` combine. */
export const typedErrors = GET((args: { id: string }) => {
    if (args.id === '') {
        return notFound({ id: args.id })
    }
    if (args.id === 'x') {
        return conflict({ existingId: 1 })
    }
    if (args.id === 'y') {
        return gone({ movedTo: args.id })
    }
    if (args.id === 'z') {
        return rateLimited()
    }
    return json({ ok: true })
})
