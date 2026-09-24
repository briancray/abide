import { refuse } from 'abide'

export const notYours = refuse.typed<'NotYours', { owner: string }>(
    'NotYours',
    403,
    'That invoice belongs to someone else.',
)

export const superseded = refuse.typed<'Superseded', { replacedBy: string }>(
    'Superseded',
    409,
    'That invoice was replaced.',
)
