import { database } from './database.ts'

Bun.serve({
    routes: {
        '/api/profile': async () =>
            Response.json(await database.profile.current()),
    },
})
