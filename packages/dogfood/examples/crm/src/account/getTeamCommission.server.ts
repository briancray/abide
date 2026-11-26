import { authorize, rpc } from '@abide/abide/server'

/** The whole team's commission this quarter: an admin's figure. */
export default rpc(() => ({ total: '$18,400' }), {
    middleware: [authorize({ role: 'admin' })],
    description: "The team's commission this quarter, for admins.",
})
