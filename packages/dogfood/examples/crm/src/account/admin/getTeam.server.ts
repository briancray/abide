import { rpc } from '@abide/abide/server'

import { TEAM } from '../lib/TEAM.server.ts'

// No middleware of its own: the section's layout guards it.
export const getTeam = rpc(
    async () => TEAM.map(({ name, role }) => ({ name, role })),
    {
        description: 'Every team member and their role, for an admin.',
    },
)
