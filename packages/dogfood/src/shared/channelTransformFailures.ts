import { refuse } from '@abide/abide'
import { z } from 'zod'

export const tooLong = refuse.named(
    'TooLong',
    422,
    'That message is longer than the conversation takes.',
    {
        schema: z.object({ length: z.number() }),
    },
)

export type TooLong = ReturnType<typeof tooLong>
