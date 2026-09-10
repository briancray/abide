import { principal, refuse } from 'abide'
import { POST } from 'abide/server'
import { database } from '#server/database'

export const signIn = POST(async ({ email }: { email: string }) => {
    const user = await database.users.byEmail(email)
    if (user === null) refuse(401, 'No such account.')
    await principal.set({ id: user.id, name: user.name })
})
