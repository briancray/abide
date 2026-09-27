import { refuse } from 'abide'
import { z } from 'zod'

export const notAPhone = refuse.named(
    'NotAPhone',
    422,
    'A phone number is ten digits.',
    {
        schema: z.object({ typed: z.string() }),
    },
)
