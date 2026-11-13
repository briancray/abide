import { principal, refuse } from '@abide/abide'
import { GET } from '@abide/abide/server'

/** What the member signed in has earned this quarter. */
export default GET(
    async () => {
        const { name } = await principal.resolved
        if (name === undefined) return refuse(401, 'Sign in again.')
        return { amount: '$6,200' }
    },
    { description: "The signed-in member's commission this quarter." },
)
