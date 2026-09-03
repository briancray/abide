import { database } from './database.ts'

Bun.serve({
    routes: {
        '/api/drafts': async (request) => {
            await database.draft.write(await request.text())
            return new Response(null, { status: 204 })
        },
    },
})
