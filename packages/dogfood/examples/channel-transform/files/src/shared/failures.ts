import { refuse } from 'abide'

export const tooLong = refuse.typed<'TooLong', { length: number }>(
    'TooLong',
    422,
    'That message is longer than the conversation takes.',
)
