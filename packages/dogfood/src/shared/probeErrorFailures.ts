import { refuse } from 'abide'

export const notReachable = refuse.typed<'NotReachable', { id: string }>(
    'NotReachable',
    503,
    'The billing service did not answer.',
)
