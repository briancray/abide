import { refuse } from 'abide'

export const notAPhone = refuse.typed<'NotAPhone', { typed: string }>(
    'NotAPhone',
    422,
    'A phone number is ten digits.',
)
