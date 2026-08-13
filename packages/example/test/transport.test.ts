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
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { abidePlugin } from 'abide/compiler/plugin'
import { registered } from 'abide/server'
import { plugin } from 'bun'
// Type-only, and that is what keeps the two processes apart: the shape is read off the literal the
// wire script prints, so a field added there cannot be missed here, and nothing of that module is
// loaded into this one.
import type { WireResult } from './transport-wire.ts'

const SERVER = new URL('../server/', import.meta.url).pathname
/** The app the shapes are derived FOR, and the repo the deriver is in. Both absolute — see `derivedShapes`. */
const APP = new URL('../', import.meta.url).pathname
const ROOT = new URL('../../../', import.meta.url).pathname

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
        // An option is server-side text, and a declared shape is one: `rename` has an input schema
        // and none of it crosses. What crosses is the consequence — here, a 422 the caller reads.
        expect(code).not.toContain('name must not be blank')
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

/**
 * A directory holding shapes this case DERIVED, for the wire process to run in.
 *
 * `plugin.ts` reads `.abide/shapes.json` beside the WORKING DIRECTORY, and that file is a build
 * artifact: gitignored, written by `bun run shapes` and by nothing in the documented gate. So the
 * enriched half of the claim below — a shape whose type is declared in ANOTHER file — was being
 * answered by whatever the last build happened to leave in the repo root. On this machine that was
 * five days stale, on a fresh clone it is absent, and from any directory but the root it is
 * unreachable: `userShape` comes back `null` and the case fails for a reason that is about the
 * machine rather than about the compiler.
 *
 * Derived rather than located, so the case owns its input. It costs ~0.3s and it is the difference
 * between asserting what the compiler DERIVES and asserting what a previous build left behind.
 */
async function derivedShapes(): Promise<string> {
    const dir = await mkdtemp(`${tmpdir()}/abide-wire-`)
    const made = Bun.spawn(
        ['bun', `${ROOT}packages/abide/compiler/shapes.ts`, APP, '--out', `${dir}/.abide/shapes.json`],
        { stdout: 'pipe', stderr: 'pipe' },
    )
    const failed = await new Response(made.stderr).text()
    if ((await made.exited) !== 0) throw new Error(`abide: the shapes derivation failed — ${failed}`)
    return dir
}

test('both laws meet over a real wire', async () => {
    // The child's cwd is this case's, not the caller's, which is what makes the answer the same from
    // the repo root and from inside the package.
    const held = await derivedShapes()
    const run = Bun.spawn(['bun', `${import.meta.dir}/transport-wire.ts`], {
        cwd: held,
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const [out, err] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text()])
    expect(err).toBe('')
    const result = JSON.parse(out.trim()) as WireResult

    // Both registries filled themselves from the imports — no filesystem scan, no manual wiring, and
    // the address is the module's own path with its subdirectory intact.
    //
    // SORTED, because the claim is WHICH addresses registered and not in what order: registration
    // order is module evaluation order, which the runner is free to vary, and asserting it made this
    // fail intermittently on a fact nothing depends on.
    expect(result.registeredRpc.slice().sort()).toEqual(
        [
            'users/getUser',
            'users/slowUser',
            'users/countdown',
            'users/add',
            'users/rename',
            'users/listening',
            'users/setAvatar',
            'admin/audit/recent',
        ].sort(),
    )
    expect(result.registeredSockets.slice().sort()).toEqual(['feed/ticks', 'feed/rooms'].sort())

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

    // A FILE is an argument. Nothing in the declaration says "upload": the client noticed the args
    // held something JSON cannot carry, sent multipart, and the handler was given the same one args
    // object with the file back where the caller put it.
    expect(result.uploaded).toEqual({ id: 4, name: 'a.png', bytes: 11 })

    // And the contract for that call is published — derived from `avatar: File` and nothing else,
    // which is what an MCP tool definition and an OpenAPI operation both read.
    expect(result.avatarShape).toEqual({
        id: { type: 'number' },
        avatar: { type: 'string', format: 'binary' },
    })
    expect(result.catalogueIds).toContain('feed/ticks')

    // A shape declared in ANOTHER file. `getUser` answers `User`, which lives in `db.ts` beside the
    // data — the ordinary place for it, and a file the compiler opened only because a handler's type
    // named it. Nothing about the endpoint restates the shape.
    expect(result.userShape).toEqual({
        type: 'object',
        properties: {
            id: { type: 'number' },
            name: { type: 'string' },
            connections: { type: 'number' },
        },
        required: ['id', 'name', 'connections'],
    })

    // A handler reached the server it is running under with nothing threaded to it: Bun hands the
    // instance to `fetch(request, self)`, `dispatch` latched it there, and `server()` read it back
    // two layers down.
    expect(result.handlerOrigin).toBe(result.servingOrigin)

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
