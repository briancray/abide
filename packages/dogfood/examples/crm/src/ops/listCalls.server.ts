import { rpc } from '@abide/abide/server'

export type Call = { id: string; note: string }

/** Answers at /ops/listCalls: the calls logged against Grace Hopper, followed by every tab reading it. */
export default rpc(
    (): Call[] => [{ id: 'c1', note: 'Wants a quote by Friday.' }],
    {
        global: true,
        key: 'id',
        description: 'The calls logged against a contact.',
    },
)
