import { principal, refuse } from '@abide/abide'
import { onPrincipal, POST } from '@abide/abide/server'
import { TEAM } from './server/TEAM.ts'

/** Seals the member's id into the cookie, and nothing else. */
export default POST(
    async ({ email }: { email: string }) => {
        const member = TEAM.find((one) => one.email === email)
        if (member === undefined) return refuse(401, 'No such account.')
        await principal.set({ id: member.id })
    },
    { description: 'Signs a team member in by email.' },
)

// Every request after it reads the member the sealed id names.
onPrincipal((claims) => {
    const { id } = claims as { id: string }
    const member = TEAM.find((one) => one.id === id)
    return member && { name: member.name, role: member.role }
})
