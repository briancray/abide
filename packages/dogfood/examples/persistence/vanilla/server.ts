import { database } from './database.ts'
import { redis } from './redis.ts'

const FLAGS_URL = 'https://flags.internal/v1'
const sockets = new Map<string, Set<Bun.ServerWebSocket>>()

// The cache that survives a restart, by hand: read, miss, write,
// and the expiry converted to the units this backend takes. Every
// caller repeats the shape, and every one of them can get the
// order wrong on its own.
async function cached<T>(
    key: string,
    ttl: number,
    build: () => Promise<T>,
) {
    const held = await redis.get(key)
    if (held !== null) return JSON.parse(held) as T
    const value = await build()
    await redis.set(key, JSON.stringify(value), 'EX', Math.ceil(ttl / 1000))
    return value
}

const flags = () =>
    cached('flags', 60_000, async () => (await fetch(FLAGS_URL)).json())

// One entry per key, so the key has to be threaded all the way to
// the cache rather than closed over where the loader was declared.
const user = (id: string) =>
    cached(`user:${id}`, 30_000, () => database.user.find(id))

// A room's standing message. Nothing collapses a republished
// identical roster, so the comparison is written here too or every
// heartbeat is a write.
async function publishRoster(room: string, members: unknown[]) {
    const key = `roster:${room}`
    const text = JSON.stringify(members)
    if ((await redis.get(key)) === text) return
    await redis.set(key, text)
    for (const socket of sockets.get(room) ?? []) socket.send(text)
}

function themeOf(request: Request) {
    // The server's half of the cookie store, spelled a second time
    // because the two sides do not share a way to say it.
    const header = request.headers.get('cookie') ?? ''
    const match = header.match(/(?:^|; )theme=([^;]*)/)
    return match ? decodeURIComponent(match[1]) : 'light'
}

Bun.serve({
    routes: {
        '/settings': async (request) => {
            const theme = themeOf(request)
            const body = await Bun.file('./index.html').text()
            const root = `<html data-theme="${theme}">`
            const html = `<!doctype html>${root}${body}`
            return new Response(html, {
                headers: { 'content-type': 'text/html' },
            })
        },
        '/api/flags': async () => Response.json(await flags()),
        '/api/users/:id': async (request) =>
            Response.json(await user(request.params.id)),
        '/api/roster/:room': async (request) => {
            await publishRoster(request.params.room, [])
            return new Response(null, { status: 204 })
        },
    },
})
