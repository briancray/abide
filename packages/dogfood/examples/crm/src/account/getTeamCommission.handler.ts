import { GET, requireRole } from '@abide/abide/server'

/** The whole team's commission this quarter: an admin's figure. */
export default GET(() => ({ total: '$18,400' }), {
    middleware: [requireRole('admin')],
    description: "The team's commission this quarter, for admins.",
})
