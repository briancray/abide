/* Type-level check (compiled by tsgo, never run): the real POST helper threads a
   declared `errors` spec into the handler's `{ errors }` ctx with full typing. */
import { error } from '../src/lib/server/error.ts'
import { POST } from '../src/lib/server/POST.ts'
import type { StandardSchemaV1 } from '../src/lib/shared/types/StandardSchemaV1.ts'

/* A schema whose inferred input is { code: string }. */
const codeSchema = {
    '~standard': {
        version: 1,
        vendor: 'test',
        validate: (value: unknown) => ({ value: value as { code: string } }),
        types: { input: {} as { code: string }, output: {} as { code: string } },
    },
} satisfies StandardSchemaV1<{ code: string }, { code: string }>

export const buy = POST(
    (_args, { errors }) => {
        // nullary constructor (no data schema)
        if (Math.random() > 0.9) {
            return errors.soldOut()
        }
        // data constructor requires the inferred input
        if (Math.random() > 0.8) {
            return error(errors.invalidCoupon({ code: 'EXPIRED' }))
        }
        if (Math.random() > 0.7) {
            // @ts-expect-error — invalidCoupon needs { code: string }, not a number
            return error(errors.invalidCoupon(5))
        }
        if (Math.random() > 0.6) {
            // @ts-expect-error — no such declared error
            return errors.nope()
        }
        return error(200, 'ok')
    },
    {
        errors: {
            soldOut: { status: 409 },
            invalidCoupon: { status: 400, data: codeSchema },
        },
    },
)
