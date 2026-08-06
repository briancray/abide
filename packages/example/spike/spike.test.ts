// The spike's whole claim, as assertions. Five things have to be true before transports are worth
// writing:
//
//   1. the two lanes can be told apart from inside a plugin
//   2. the transport module's body does not reach the browser bundle
//   3. both lanes compute the SAME address for the same export
//   4. a declaration that does not belong fails loudly rather than becoming `undefined` in a browser
//   5. the address is the module's own path, so nothing has to assign one
//
// Everything else about rpc and socket is ordinary work. These five would force a redesign.

import { expect, test } from 'bun:test'
import { plugin } from 'bun'
import { elidePlugin, registration, stub } from './elide.ts'
import { ElisionError, endpointsOf } from './exports.ts'
import { endpointId, kindOf } from './ids.ts'
import { RPC_PREFIX, SOCKET_PREFIX } from './PATHS.ts'
import { registered } from './registry.ts'

interface WireResult {
    registeredRpc: string[]
    registeredSockets: string[]
    coldPeek: unknown
    coldPending: boolean
    value: { id: number; name: string; connections: number }
    warmPeek: { id: number; name: string; connections: number }
    settled: boolean
    nested: { entries: number }
    requestsForThreeReaders: number
    missingError: string
    appRouteBody: string
    socketLatest: { n: number }
    socketTranscript: { n: number }[]
}

const USERS = `${import.meta.dir}/server/rpc/users.ts`
const AUDIT = `${import.meta.dir}/server/rpc/admin/audit.ts`
const FEED = `${import.meta.dir}/server/sockets/feed.ts`
const SOURCE = await Bun.file(USERS).text()

test('the directory is the kind', () => {
    expect(kindOf(USERS)).toBe('rpc')
    expect(kindOf(AUDIT)).toBe('rpc')
    expect(kindOf(FEED)).toBe('socket')
    expect(kindOf(`${import.meta.dir}/db.ts`)).toBeNull()
})

test('the module path is the address, subdirectories included', () => {
    expect(endpointId(USERS, 'getUser')).toBe('users/getUser')
    expect(endpointId(AUDIT, 'recent')).toBe('admin/audit/recent')
    expect(endpointId(FEED, 'ticks')).toBe('feed/ticks')
    // Which is to say: the whole URL is a fact about where the file is.
    expect(RPC_PREFIX + endpointId(AUDIT, 'recent')).toBe('/__abide/rpc/admin/audit/recent')
    expect(SOCKET_PREFIX + endpointId(FEED, 'ticks')).toBe('/__abide/socket/feed/ticks')
})

test('an endpoint is recognised syntactically, with its method', () => {
    expect(endpointsOf(SOURCE, USERS, 'rpc')).toEqual([
        { name: 'getUser', method: 'GET' },
        { name: 'slowUser', method: 'GET' },
    ])
})

test('a declaration the directory does not allow is an error naming both', () => {
    const misplaced = `export const feed = socket<number>()\n`
    expect(() => endpointsOf(misplaced, 'server/rpc/x.ts', 'rpc')).toThrow(ElisionError)
    expect(() => endpointsOf(misplaced, 'server/rpc/x.ts', 'rpc')).toThrow(/`feed` with `socket`/)
    // …and it is fine where it belongs.
    expect(endpointsOf(misplaced, 'server/sockets/x.ts', 'socket')).toEqual([
        { name: 'feed', method: 'socket' },
    ])
})

test('a non-endpoint export is a compile error naming the export', () => {
    const bad = `import { db } from './db.ts'\nexport function helper() { return db }\n`
    expect(() => endpointsOf(bad, 'server/rpc/bad.ts', 'rpc')).toThrow(/exports `function`/)
})

test('a type-only export is skipped rather than rejected', () => {
    const withType = `export type User = { id: number }\nexport const a = GET(() => 1)\n`
    expect(endpointsOf(withType, 'server/rpc/x.ts', 'rpc')).toEqual([{ name: 'a', method: 'GET' }])
})

test('both lanes emit the same address for the same export', () => {
    const endpoints = endpointsOf(SOURCE, USERS, 'rpc')
    expect(stub(USERS, 'rpc', endpoints)).toContain('"users/getUser"')
    expect(registration(USERS, 'rpc', endpoints)).toContain('"users/getUser"')
})

test('the browser bundle carries the address and not the module', async () => {
    const entry = `${import.meta.dir}/browser_entry.ts`
    await Bun.write(
        entry,
        `import { getUser } from './server/rpc/users.ts'\nimport { ticks } from './server/sockets/feed.ts'\nconsole.log(getUser, ticks)\n`,
    )
    try {
        const built = await Bun.build({ entrypoints: [entry], target: 'browser', plugins: [elidePlugin] })
        expect(built.success).toBe(true)
        const code = await built.outputs[0]!.text()

        // Both addresses are there…
        expect(code).toContain('users/getUser')
        expect(code).toContain('feed/ticks')
        // …and the handler's world is not. `db.ts` has a module-level side effect, so its absence is
        // elision rather than tree-shaking.
        expect(code).not.toContain('ABIDE_SPIKE_SERVER_ONLY_SECRET')
        expect(code).not.toContain('findUser')
    } finally {
        await Bun.file(entry).delete()
    }
})

test('the server lane registers what the browser calls', async () => {
    plugin(elidePlugin)
    await import('./server/rpc/users.ts')
    await import('./server/sockets/feed.ts')
    // Registration is what the plugin appends; if the runtime lane did not intercept the module,
    // this is where the spike fails and the seam needs a preload instead.
    expect(registered('rpc')).toContain('users/getUser')
    expect(registered('socket')).toContain('feed/ticks')
})

// Spawned rather than run here: `bunfig.toml` preloads happy-dom for every `bun test` file, and
// happy-dom replaces `Response` and `URL` with its own — which `Bun.serve` cannot serialise. See
// `wire.ts`. The lane split is the finding; this test only checks the result.
test('both laws meet over the wire', async () => {
    const run = Bun.spawn(['bun', `${import.meta.dir}/wire.ts`], { stdout: 'pipe', stderr: 'pipe' })
    const [out, err] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text()])
    expect(err).toBe('')
    const result = JSON.parse(out.trim()) as WireResult

    // Both registries filled themselves from the imports — no filesystem scan, no manual wiring.
    expect(result.registeredRpc).toEqual(['users/getUser', 'users/slowUser', 'admin/audit/recent'])
    expect(result.registeredSockets).toEqual(['feed/ticks'])

    // A probe observes and never causes: selecting the slot started nothing.
    expect(result.coldPeek).toBeNull()
    expect(result.coldPending).toBe(false)

    // The value came over the wire and is retained after it.
    expect(result.value).toEqual({ id: 7, name: 'user 7', connections: 1 })
    expect(result.warmPeek).toEqual({ id: 7, name: 'user 7', connections: 1 })
    expect(result.settled).toBe(true)
    expect(result.nested).toEqual({ entries: 3 })

    // The headline: three concurrent readers of one key cost ONE request. Nothing in the transport
    // coalesces — the slot does, exactly as it already did for a local load.
    expect(result.requestsForThreeReaders).toBe(1)

    // A missing endpoint fails the way a failed load fails: from the read.
    expect(result.missingError).toMatch(/404/)

    // Anything outside the reserved prefix is the app's, and `dispatch` hands it back untouched.
    expect(result.appRouteBody).toBe('an app route')

    // The socket half: published on the server into a plain channel, read on the client off the
    // client's own channel surface. Neither side's channel knows a wire is involved.
    expect(result.socketLatest).toEqual({ n: 3 })
    expect(result.socketTranscript).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }])
})
