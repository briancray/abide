import { GET } from '../../GET.ts'

// Destructuring defaults of every literal shape the deriver can serialise, plus the shapes it must
// decline: a call and a reference have no value at derivation time.
export const withDefaults = GET(
    ({
        message = 'hello',
        limit = 10,
        loud = true,
        quiet = false,
        plain,
        stamped = Date.now(),
    }: {
        message?: string
        limit?: number
        loud?: boolean
        quiet?: boolean
        plain?: string
        stamped?: number
    }) => ({ message, limit, loud, quiet, plain, stamped }),
)
