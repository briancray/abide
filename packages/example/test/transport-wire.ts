// Both laws, end to end, over a real wire: register the plugin, import the transport modules, serve
// them under the reserved prefix, and read them back through the stubs' own `remote` and
// `remoteSocket`.
//
// A separate PROCESS rather than a test body, because `bunfig.toml` preloads happy-dom for every
// `bun test` file and happy-dom replaces `URL` — and `AbortController`, `Event` and `WebSocket` —
// with its own, which `Bun.serve` cannot serialise. (`Response` and the rest of the data layer are
// put back by the preload; see `abide/tests`' `happydom.ts` for where that line is drawn and why.)
// The UI suites need the emulator and a transport needs it gone, so they cannot be the same lane.
// `transport.test.ts` spawns this and asserts on the JSON it prints.
//
// Run it directly to watch it: `bun packages/example/test/transport-wire.ts`.

import { remote, remoteSocket } from 'abide/runtime/transport'
import { abidePlugin } from 'abide/compiler/plugin'
import { dispatch, registered, websocket } from 'abide/server'
import { until } from 'abide/tests'
import { plugin } from 'bun'

plugin(abidePlugin)

// Imported AFTER the plugin is registered: the appended registration is what puts a handler in the
// table, so an import that beat the plugin would produce an empty one.
const HERE = new URL('../server/', import.meta.url).pathname
const [, , loaded] = await Promise.all([
    import(`${HERE}rpc/users.ts`),
    import(`${HERE}rpc/admin/audit.ts`),
    import(`${HERE}sockets/feed.ts`),
])
const feed = loaded as { ticks: { publish(message: { n: number }): void } }

let requests = 0
const server = Bun.serve({
    port: 0,
    fetch: async (request, self) => {
        requests++
        return (await dispatch(request, self)) ?? new Response('an app route', { status: 404 })
    },
    websocket,
})
const base = server.url.origin

// --- rpc ---------------------------------------------------------------------

const getUser = remote<{ id: number }, { id: number; name: string; connections: number }>('users/getUser', {
    base,
})

const coldPeek = getUser({ id: 7 }).peek()
const coldPending = getUser({ id: 7 }).pending()
const value = await getUser({ id: 7 })
const warmPeek = getUser({ id: 7 }).peek()
const settled = getUser({ id: 7 }).settled()
// A read travels as an HTTP GET, which is the whole reason the five names are HTTP methods.
const readMethod = (await getUser.raw({ id: 7 })).ok

const nested = await remote<{ limit: number }, { entries: number }>('admin/audit/recent', { base })({
    limit: 3,
})

// Three concurrent readers of one key must reach the wire once.
const before = requests
const slow = remote<{ id: number }, unknown>('users/slowUser', { base })
await Promise.all([slow({ id: 1 }), slow({ id: 1 }), slow({ id: 1 })])
const requestsForThreeReaders = requests - before

// A handler that yields, over a real response body.
const countdown = remote<{ from: number }, number>('users/countdown', { base, stream: true })
const streamed: number[] = []
for await (const n of countdown({ from: 3 })) streamed.push(n)

// A mutation travels as its own method and retains nothing.
const rename = remote<{ id: number; name: string }, { name: string }>('users/rename', {
    base,
    method: 'POST',
})
await rename({ id: 2, name: 'ada' })
const renamed = await remote<{ id: number }, { name: string }>('users/getUser', { base })({ id: 2 })

// A FILE, over a real multipart body. The client sent it that way because the args held something
// JSON cannot carry; nothing about the declaration says "upload".
const setAvatar = remote<{ id: number; avatar: File }, { id: number; name: string; bytes: number }>(
    'users/setAvatar',
    { base, method: 'POST' },
)
const uploaded = await setAvatar({ id: 4, avatar: new File(['hello bytes'], 'a.png', { type: 'image/png' }) })

// The published contract, over the wire that serves it.
const catalogue = (await (await fetch(new URL('/__abide/schema', base))).json()) as {
    id: string
    input?: { properties?: Record<string, unknown> }
    output?: unknown
}[]

// A handler asking which server it is running under, having been handed nothing: `dispatch` latched
// what `fetch` gave it, and `server()` is where the handler reads it back.
const listening = await remote<Record<string, never>, { origin: string }>('users/listening', { base })({})

let missingError = ''
try {
    await remote<{ id: number }, unknown>('users/nope', { base })({ id: 1 })
} catch (error) {
    missingError = String(error)
}

// A path outside the reserved prefix is not abide's, and `dispatch` says so by returning nothing.
const appRoute = await fetch(new URL('/users/getUser', base))

// --- socket ------------------------------------------------------------------

// Waited for rather than slept past, both directions: the upgrade is observable as the server's own
// connection count, and delivery is observable as the transcript the claim is about. A fixed sleep
// here asserts the timer.
const openBeforeTicks = server.pendingWebSockets
const ticks = remoteSocket<{ n: number }>('feed/ticks', { base, channel: { tail: 8 } })
ticks.chunks() // the read is what opens the connection
await until(() => server.pendingWebSockets > openBeforeTicks)
// Published on the SERVER, into a plain channel. Nothing about the publish knows a socket exists.
feed.ticks.publish({ n: 1 })
feed.ticks.publish({ n: 2 })
feed.ticks.publish({ n: 3 })
await until(() => ticks.chunks().length === 3)

const rooms = remoteSocket<string, { room: string }>('feed/rooms', { base, channel: { tail: 8 } })
const general = rooms({ room: 'general' })
general.chunks()
// A SLEEP, and it cannot be an `until` on the server's connection count like the one above: this
// publish is a CLIENT send, and the client's `WebSocket` is still CONNECTING for a moment after the
// server has accepted it. `connect`'s publish queue guards on `wire === null`, but `start()` assigns
// `wire` synchronously — so a send in that window throws `InvalidStateError` instead of queueing.
await Bun.sleep(30)
general.publish('hi')
await until(() => general.chunks().length === 1)

const result = {
    registeredRpc: registered('rpc'),
    registeredSockets: registered('socket'),
    coldPeek: coldPeek ?? null,
    coldPending,
    value,
    warmPeek,
    settled,
    readMethod,
    nested,
    requestsForThreeReaders,
    streamed,
    streamedChunks: countdown({ from: 3 }).chunks(),
    renamed: renamed.name,
    uploaded,
    avatarShape: catalogue.find((one) => one.id === 'users/setAvatar')?.input?.properties ?? null,
    // Derived from `User` in `db.ts` — a file the compiler opened because a handler's type named it.
    userShape: (catalogue.find((one) => one.id === 'users/getUser') as { output?: unknown })?.output ?? null,
    catalogueIds: catalogue.map((one) => one.id),
    handlerOrigin: listening.origin,
    servingOrigin: base,
    missingError,
    appRouteStatus: appRoute.status,
    appRouteBody: await appRoute.text(),
    socketLatest: ticks.peek() ?? null,
    socketTranscript: ticks.chunks(),
    roomTranscript: general.chunks(),
}

/**
 * The shape `transport.test.ts` asserts on, read off the literal rather than restated beside it.
 *
 * `import type` is erased, so the test still gets nothing of this process — which is the whole
 * reason the wire runs in a spawned one.
 */
export type WireResult = typeof result

console.log(JSON.stringify(result))

ticks.close()
rooms.close()
await server.stop(true)
process.exit(0)
