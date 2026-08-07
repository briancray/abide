// The half of the transport a browser card cannot make a claim about.
//
// `demos/transport.ts` carries both laws — coalescing, the shared surface, streams, rooms, the
// stub's text — through `loopback()`, so the same body runs headless and on the page. Three things
// are left over, and none of them can:
//
//   1. a handler's body actually ABSENT from a bundle, which needs a real `Bun.build`
//   2. the server lane registering itself, which needs the runtime plugin to have intercepted a real
//      module on a real filesystem
//   3. both laws over a real socket, which needs a server — and `bunfig.toml` preloads happy-dom for
//      every test file, whose `Response` and `URL` `Bun.serve` cannot serialise. That is why the wire
//      runs in a spawned process; see `transport-wire.ts`.

import { expect, test } from 'bun:test'
import { abidePlugin } from 'abide/compiler/plugin'
import { registered } from 'abide/server'
import { plugin } from 'bun'
// Type-only, and that is what keeps the two processes apart: the shape is read off the literal the
// wire script prints, so a field added there cannot be missed here, and nothing of that module is
// loaded into this one.
import type { WireResult } from './transport-wire.ts'

const SERVER = new URL('../server/', import.meta.url).pathname

test('the browser bundle carries the address and not the module', async () => {
    const entry = `${SERVER}browser_entry.ts`
    await Bun.write(
        entry,
        `import { getUser, countdown } from './rpc/users.ts'\nimport { ticks } from './sockets/feed.ts'\nconsole.log(getUser, countdown, ticks)\n`,
    )
    try {
        const built = await Bun.build({ entrypoints: [entry], target: 'browser', plugins: [abidePlugin] })
        expect(built.success).toBe(true)
        const code = await (built.outputs[0] as { text(): Promise<string> }).text()

        // Both addresses are there…
        expect(code).toContain('users/getUser')
        expect(code).toContain('feed/ticks')
        // …a handler that yields says so, so the stub reads the response as chunks…
        expect(code).toContain('stream: true')
        // …and the handler's world is not. `db.ts` has a module-level side effect, so its absence is
        // ELISION rather than something tree-shaking would have done anyway.
        expect(code).not.toContain('ABIDE_EXAMPLE_SERVER_ONLY_SECRET')
        expect(code).not.toContain('findUser')
    } finally {
        await Bun.file(entry).delete()
    }
})

test('the server lane registers what the browser calls, with no filesystem scan', async () => {
    plugin(abidePlugin)
    await import(`${SERVER}rpc/users.ts`)
    await import(`${SERVER}sockets/feed.ts`)
    // Registration is what the compiler appends. If the runtime lane did not intercept the module,
    // this is where the seam fails and it needs a preload instead.
    expect(registered('rpc')).toContain('users/getUser')
    expect(registered('socket')).toContain('feed/ticks')
})

test('both laws meet over a real wire', async () => {
    const run = Bun.spawn(['bun', `${import.meta.dir}/transport-wire.ts`], {
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const [out, err] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text()])
    expect(err).toBe('')
    const result = JSON.parse(out.trim()) as WireResult

    // Both registries filled themselves from the imports — no filesystem scan, no manual wiring, and
    // the address is the module's own path with its subdirectory intact.
    expect(result.registeredRpc).toEqual([
        'users/getUser',
        'users/slowUser',
        'users/countdown',
        'users/rename',
        'admin/audit/recent',
    ])
    expect(result.registeredSockets).toEqual(['feed/ticks', 'feed/rooms'])

    // A probe observes and never causes: selecting the slot started nothing.
    expect(result.coldPeek).toBeNull()
    expect(result.coldPending).toBe(false)

    // The value came over the wire and is retained after it.
    expect(result.value).toEqual({ id: 7, name: 'user 7', connections: 1 })
    expect(result.warmPeek).toEqual(result.value)
    expect(result.settled).toBe(true)
    expect(result.readMethod).toBe(true)
    expect(result.nested).toEqual({ entries: 3 })

    // The headline: three concurrent readers of one key cost ONE request. Nothing in the transport
    // coalesces — the slot does, exactly as it already did for a local load.
    expect(result.requestsForThreeReaders).toBe(1)

    // A handler that yields is a stream on both sides, over a real response body.
    expect(result.streamed).toEqual([3, 2, 1])
    expect(result.streamedChunks).toEqual([3, 2, 1])

    // A mutation ran and the read that follows it sees what it wrote.
    expect(result.renamed).toBe('ada')

    // A missing endpoint fails the way a failed load fails: from the read.
    expect(result.missingError).toMatch(/no endpoint/)

    // Anything outside the reserved prefix is the app's, and `dispatch` hands it back untouched.
    expect(result.appRouteStatus).toBe(404)
    expect(result.appRouteBody).toBe('an app route')

    // The socket half: published on the server into a plain channel, read on the client off the
    // client's own channel surface. Neither side's channel knows a wire is involved.
    expect(result.socketLatest).toEqual({ n: 3 })
    expect(result.socketTranscript).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }])
    // …and a room the client published into, which the server's own policy decided the shape of.
    expect(result.roomTranscript).toEqual(['echoed: hi'])
}, 20_000)
