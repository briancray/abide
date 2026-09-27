import { refuse } from 'abide'
import { z } from 'zod'

export const notYours = refuse.named(
    'NotYours',
    403,
    'That invoice belongs to someone else.',
    {
        schema: z.object({ owner: z.string() }),
    },
)

export const superseded = refuse.named(
    'Superseded',
    409,
    'That invoice was replaced.',
    {
        schema: z.object({ replacedBy: z.string() }),
    },
)
