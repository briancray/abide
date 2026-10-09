import { POST, principal } from 'abide/server'

/** Seals the id alone, and answers with what `onPrincipal` made of it. */
export const signInAs = POST(
    async ({ id }: { id: string }) => {
        await principal.set({ id })
        const { name = '', role = '' } = principal.resolved()
        return { id, name, role }
    },
    { description: 'Signs in as an id, and answers who that is.' },
)
