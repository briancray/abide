import { principal, refuse } from '@abide/abide'
import { POST } from '@abide/abide/server'
import { principalSessionDatabase } from '#server/principalSessionDatabase'

export const signIn = POST(
    async ({ email }: { email: string }) => {
        const user = await principalSessionDatabase.users.byEmail(email)
        if (user === null) return refuse(401, 'No such account.')
        await principal.set({ id: user.id, name: user.name })
    },
    { description: 'Signs in by email.' },
)

export const signOut = POST(() => principal.clear(), {
    description: 'Signs out.',
})
