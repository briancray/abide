import { refuse } from 'abide'
import { z } from 'zod'

export const notReachable = refuse.named(
    'NotReachable',
    503,
    'The billing service did not answer.',
    {
        schema: z.object({ id: z.string() }),
    },
)
