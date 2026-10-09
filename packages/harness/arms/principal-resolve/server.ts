// THE SEAL AND THE LOOKUP, BY HAND. The cookie carries an id and a
// signature over it; the record is looked up from the id, and every
// other route that wants the user has to unseal and look it up again.
const SECRET = crypto.randomUUID()

const USERS: Record<string, { id: string; name: string; role: string }> = {
    ada: { id: 'ada', name: 'Ada Lovelace', role: 'admin' },
    grace: { id: 'grace', name: 'Grace Hopper', role: 'sales' },
}

function seal(id: string): string {
    const signature = new Bun.CryptoHasher('sha256', SECRET)
        .update(id)
        .digest('base64url')
    return `${id}.${signature}`
}

Bun.serve({
    routes: {
        '/api/signInAs': async (request) => {
            const { id } = (await request.json()) as { id: string }
            const cookie = `session=${seal(id)}; HttpOnly; SameSite=Lax`
            return Response.json(USERS[id] ?? null, {
                headers: { 'set-cookie': `${cookie}; Path=/` },
            })
        },
    },
})
