// Both laws, end to end, in a lane with no DOM emulator: register the plugin, import the transport
// modules, serve them under the reserved prefix, and read them back through the stubs' `remote` and
// `remoteSocket`.
//
// It is a separate PROCESS rather than a test body because `bunfig.toml` preloads happy-dom for
// every `bun test` file, and happy-dom replaces `Response` and `URL` with its own. `Bun.serve`
// cannot serialise a happy-dom `Response`, so a transport simply cannot be exercised in that lane.
// That is the one structural thing this spike found: the UI suites need the emulator and the
// transport suites need it gone, so they cannot be the same `bun test` lane.
//
// Run directly (`bun packages/example/spike/wire.ts`); `spike.test.ts` spawns it and asserts on the
// JSON it prints.

import { plugin } from 'bun'
import { elidePlugin } from './elide.ts'
import { endpointId } from './ids.ts'

plugin(elidePlugin)

// Imported AFTER the plugin is registered — the appended registration is what puts a handler in the
// table, so an import that beat the plugin would produce an empty one.
const USERS = `${import.meta.dir}/server/rpc/users.ts`
const AUDIT = `${import.meta.dir}/server/rpc/admin/audit.ts`
const FEED = `${import.meta.dir}/server/sockets/feed.ts`
await import(USERS)
await import(AUDIT)
const feed = (await import(FEED)) as { ticks: { publish(message: { n: number }): void } }

const { dispatch, registered, websocket } = await import('./registry.ts')
const { remote } = await import('./rpc.ts')
const { remoteSocket } = await import('./sockets.ts')

const server = Bun.serve({
    port: 0,
    fetch: async (request, self) =>
        (await dispatch(request, self)) ?? new Response('an app route', { status: 404 }),
    websocket,
})
const base = server.url.origin

// --- rpc -------------------------------------------------------------------------------------
const id = endpointId(USERS, 'getUser')
const getUser = remote<{ id: number }, { id: number; name: string }>(id, 'GET', base)

const coldPeek = getUser({ id: 7 }).peek()
const coldPending = getUser({ id: 7 }).pending()
const value = await getUser({ id: 7 })
const warmPeek = getUser({ id: 7 }).peek()
const settled = getUser({ id: 7 }).settled()

// A nested module keeps its subdirectory in the address.
const nested = await remote<{ limit: number }, { entries: number }>(
    endpointId(AUDIT, 'recent'),
    'GET',
    base,
)({
    limit: 3,
})

// Three concurrent readers of one key must reach the wire once.
let requests = 0
const counted = Bun.serve({
    port: 0,
    fetch: async (request, self) => {
        requests++
        return (await dispatch(request, self)) ?? new Response('an app route', { status: 404 })
    },
    websocket,
})
const countedUser = remote<{ id: number }, unknown>(id, 'GET', counted.url.origin)
await Promise.all([countedUser({ id: 1 }), countedUser({ id: 1 }), countedUser({ id: 1 })])

let missingError = ''
try {
    await remote<{ id: number }, unknown>('users/nope', 'GET', base)({ id: 1 })
} catch (error) {
    missingError = String(error)
}

// A path outside the reserved prefix is not abide's, and `dispatch` says so by returning nothing.
const appRoute = await fetch(new URL('/users/getUser', base))

// --- socket ----------------------------------------------------------------------------------
const ticks = remoteSocket<{ n: number }>(endpointId(FEED, 'ticks'), base)
await ticks.opened
// Published on the SERVER, into a plain channel. Nothing about the publish knows a socket exists.
feed.ticks.publish({ n: 1 })
feed.ticks.publish({ n: 2 })
feed.ticks.publish({ n: 3 })
// One turn of the loop for the frames to land.
await Bun.sleep(25)

console.log(
    JSON.stringify({
        registeredRpc: registered('rpc'),
        registeredSockets: registered('socket'),
        id,
        nestedId: endpointId(AUDIT, 'recent'),
        socketId: endpointId(FEED, 'ticks'),
        coldPeek: coldPeek ?? null,
        coldPending,
        value,
        warmPeek,
        settled,
        nested,
        requestsForThreeReaders: requests,
        missingError,
        appRouteStatus: appRoute.status,
        appRouteBody: await appRoute.text(),
        // The client channel's own surface, filled by the wire alone.
        socketLatest: ticks.peek() ?? null,
        socketTranscript: ticks.chunks(),
    }),
)

await server.stop(true)
await counted.stop(true)
process.exit(0)
