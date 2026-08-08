// `abide dev` — the app kept up against what the files currently say.
//
// Not a demo, for the reason `start.test.ts` is not: a demo case runs the same body headless AND
// inside a browser card, and a card cannot bind a socket, spawn a process or watch a directory.
//
// Every case here is a face of the one claim that makes this a different command from `abide start`
// rather than a flag on it: a developer's server comes UP and stays up. It builds the client itself
// so there is nothing to run first, it hops rather than refusing a taken port, it restarts when a
// file changes — and it comes back at the SAME address, because a reload that moved the app out from
// under the open tab is not a reload.
//
// The pinned address is the subtle one and it is asserted directly. The first child resolves its port
// the way `abide start` does and may hop; every child after it is told where to land, so a port that
// frees up mid-session cannot pull the app back onto it.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdtemp, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { CLIENT_ROUTE } from 'abide/cli'
import {
    abide,
    addressOf,
    BINARY,
    LISTENING,
    EXAMPLE_ROOT as ROOT,
    type Running,
    reading,
    started,
} from './spawned.ts'

let app: Running

// Port `0` throughout — the kernel's own spelling of "whatever is free". The supervisor pins whatever
// it resolves to, so it is also the address every restart in this file comes back on. The one case
// that needs a TAKEN port is the hop, and it takes one it holds itself.

/** What a browser is holding: the status line it upgraded with, and a promise that it went away. */
interface Held {
    status: string
    closed: Promise<string>
    end: () => void
}

/**
 * The reload socket, handshaken BY HAND over a raw connection.
 *
 * Not the `WebSocket` global, because under `bun test` that is a `ws` shim which cannot complete a
 * handshake against Bun's own server — it closes with `1002 Expected 101 status code` where both the
 * native client and these bytes get their `101`. So the client every other lane uses is not available
 * to this file.
 *
 * Which is no loss: what a case here needs is to watch a CONNECTION open and then go away, and that
 * is a request and a status line rather than a client. It also makes the assertion the wire's own —
 * a `101` is the upgrade, whoever asked for it.
 */
async function reloadSocket(base: string): Promise<Held> {
    const at = new URL('__abide/socket/abide/reload', base)
    const upgraded = Promise.withResolvers<string>()
    const went = Promise.withResolvers<string>()

    let head = ''
    const decoder = new TextDecoder()
    const socket = await Bun.connect({
        hostname: at.hostname,
        port: Number(at.port),
        socket: {
            open(live) {
                live.write(
                    `GET ${at.pathname} HTTP/1.1\r\nHost: ${at.host}\r\n` +
                        'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
                        `Sec-WebSocket-Key: ${btoa('0123456789abcdef')}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
                )
            },
            data(_live, chunk) {
                if (head.includes('\r\n\r\n')) return
                head += decoder.decode(chunk)
                if (head.includes('\r\n\r\n')) upgraded.resolve(head.slice(0, head.indexOf('\r\n')))
            },
            close: () => went.resolve('closed'),
            error: () => went.resolve('closed'),
        },
    })
    return { status: await upgraded.promise, closed: went.promise, end: () => void socket.end() }
}

beforeAll(async () => {
    app = await started(['dev', '--port', '0'])
}, 30_000)

afterAll(() => {
    app?.child.kill('SIGKILL')
})

test('the client is built into memory, with nothing on disk to have built first', async () => {
    const markup = await (await fetch(app.base)).text()
    const script = /<script type="module" src="([^"]+)">/.exec(markup)
    expect(script).not.toBeNull()
    const src = (script as RegExpExecArray)[1] as string
    expect(src).toStartWith(CLIENT_ROUTE)

    // The SOURCE name, where `abide build` writes `client-<hash>.js`. That is the falsifiable half of
    // "this is not the directory `abide build` wrote" — a hash in the name would mean the manifest
    // came off a disk — and it is also what lets a breakpoint survive a rebuild.
    expect(src).toBe(`${CLIENT_ROUTE}client.js`)

    const asset = await fetch(`${app.base}${src.slice(1)}`)
    expect(asset.status).toBe(200)
    expect(asset.headers.get('content-type')).toContain('javascript')
    // The price of a stable name: nothing may be cached, because the address no longer promises one
    // set of bytes. `abide start` makes the opposite trade with `immutable`, and both follow from the
    // name.
    expect(asset.headers.get('cache-control')).toBe('no-store')

    // The same elision `abide build` makes, because it is the same `target: 'browser'` lane: the
    // client gets the ADDRESS of the rpc and none of what is behind it.
    expect(await asset.text()).toContain('users/getUser')
})

test('the page is the app’s own, with a reload client that is not in the bundle', async () => {
    const answered = await fetch(`${app.base}users/42`)
    expect(answered.status).toBe(200)
    // The four layers are the same four: the app's document, its pages, its onion, its endpoints.
    expect(answered.headers.get('x-example')).toBe('served')
    const markup = await answered.text()
    expect(markup).toContain('<section class="users">')
    expect(markup).toContain('42')

    // INLINE, and that is the claim rather than an implementation note: a client build that is broken
    // is exactly when the page has to still be able to reconnect and reload itself once it is fixed.
    // A reload client that shipped in the bundle could not do that.
    expect(markup).toContain('__abide/socket/abide/reload')
    expect(markup).toContain('location.reload()')

    const health = await fetch(`${app.base}__abide/health`)
    expect(((await health.json()) as { example: unknown }).example).toEqual({ serving: true })
})

test('a change restarts the app, and the socket a browser holds is what notices', async () => {
    const live = await reloadSocket(app.base)
    expect(live.status).toContain('101')

    // The mtime and nothing else: this is a file the repository tracks, and a case that rewrote it to
    // prove a watcher works would be a case that can fail by leaving the tree dirty.
    const now = new Date()
    await utimes(`${ROOT}/app.ts`, now, now)

    // The whole live-reload contract, from the browser's side: the socket it is holding goes away.
    // Nothing is PUBLISHED on that channel — a "reload now" frame could only be written by a process
    // that is about to stop being the one serving the page.
    expect(await live.closed).toBe('closed')

    const back = await app.until(LISTENING)
    // The SAME address. The supervisor pinned it off the first child, so a restart is invisible to a
    // page that was already open — which is the only thing that makes reconnecting a reload at all.
    expect(addressOf(back)).toBe(app.base)

    const again = await reloadSocket(app.base)
    expect(again.status).toContain('101')
    again.end()

    expect((await fetch(app.base)).status).toBe(200)
}, 30_000)

test('--port hops where abide start refuses, and says where it came from', async () => {
    // Held by this process, so the port is genuinely in use and this case does not depend on
    // anything else running.
    const holder = Bun.serve({ port: 0, fetch: () => new Response('mine') })
    // Through `Number` because the hop is asserted as ARITHMETIC — the next port, not merely another
    // one — and a bound server's port is typed as possibly absent.
    const taken = Number(holder.port)
    const hopped = await started(['dev', '--port', String(taken)])
    try {
        // The distinguishing row: `abide start` exits 1 on this exact input, because a deploy that
        // quietly listened somewhere else is a health check passing against the process it was meant
        // to replace. A developer wants the thing to come up.
        expect(hopped.base).not.toContain(`:${taken}`)
        // UPWARD and within the range it walks, rather than exactly `taken + 1`. The next port is
        // what it tries first, but nothing here owns that port — another process taking it mid-case
        // would make this a test of what else is running on the machine, which is the one thing a
        // case about hopping must not be.
        const landed = Number(new URL(hopped.base).port)
        expect(landed).toBeGreaterThan(taken)
        expect(landed).toBeLessThanOrEqual(taken + 64)
        // Said out loud, because a port a developer did not ask for is one they have to be told about.
        expect(await hopped.until('hopped from')).toContain(`hopped from ${taken}`)
        expect((await fetch(hopped.base)).status).toBe(200)
    } finally {
        hopped.child.kill('SIGKILL')
        holder.stop(true)
    }
}, 30_000)

test('SIGTERM ends it promptly even with a browser holding the reload socket', async () => {
    const doomed = await started(['dev', '--port', '0'])
    const live = await reloadSocket(doomed.base)
    expect(live.status).toContain('101')

    // A socket never ends, so a GRACEFUL close waits for it forever. One open tab must not be able to
    // make Ctrl-C hang, nor a restart wait out the supervisor's patience before it resorts to SIGKILL.
    const began = Date.now()
    doomed.child.kill('SIGTERM')
    expect(await doomed.child.exited).toBe(0)
    expect(Date.now() - began).toBeLessThan(5000)
    expect(await live.closed).toBe('closed')
}, 30_000)

test('killing it takes the server with it, because it is one process', async () => {
    const orphaned = await started(['dev', '--port', '0'])
    const base = orphaned.base
    expect((await fetch(base)).status).toBe(200)

    // One pid, said as a fact about the process table rather than about the design: `abide dev` has
    // no children, because the app is an isolate inside it. A worker is a thread and does not appear.
    const children = await new Response(
        Bun.spawn(['pgrep', '-P', String(orphaned.child.pid)], { stdout: 'pipe', stderr: 'ignore' }).stdout,
    ).text()
    expect(children.trim()).toBe('')

    // SIGKILL, so nothing gets a chance to tidy up on the way out — no handler runs, anywhere. The
    // app is in a WORKER rather than a child process, so the socket dies with the pid and there is
    // nothing to leak; the same case against a child is a listening process that outlives whatever
    // was supervising it, and the next `abide dev` hopping around the corpse of the last one. This
    // is the case that would catch a second process being reintroduced.
    orphaned.child.kill('SIGKILL')
    await orphaned.child.exited

    let answering = true
    const stop = Date.now() + 10_000
    while (answering && Date.now() < stop) {
        answering = await fetch(base).then(
            () => true,
            () => false,
        )
    }
    expect(answering).toBe(false)
}, 30_000)

test('Ctrl-C the instant it says it is listening still drains', async () => {
    // No awaits between the line and the signal, deliberately. The worker prints `listening` on its
    // way up, and a developer who reads that and hits Ctrl-C lands in whatever window exists between
    // the line and the handler being installed — where the DEFAULT action applies and the app is
    // killed without its `onStop` ever running. `130`/`143` here is that window; `0` is the handler.
    const rushed = reading(['bun', BINARY, 'dev', '--port', '0'], { cwd: ROOT })
    await rushed.until(LISTENING)
    rushed.child.kill('SIGINT')
    expect(await rushed.child.exited).toBe(0)
}, 30_000)

test('the command line is refused by the process that would have bound the socket', async () => {
    // Parsed by the CHILD, all of it — there is one `portFrom`, and `abide dev --port nope` is refused
    // by the same one that refuses `abide start --port nope`. The supervisor forwards what it answered.
    const nonsense = await abide(['dev', '--port', 'nope'], { cwd: ROOT })
    expect(nonsense.code).toBe(2)
    expect(nonsense.err).toContain('is not a port')

    const unknown = await abide(['dev', '--watch'], { cwd: ROOT })
    expect(unknown.code).toBe(2)
    expect(unknown.err).toContain('unknown option')
}, 30_000)

test('a directory with no app refuses, rather than watching it forever', async () => {
    const empty = await mkdtemp(`${tmpdir()}/abide-dev-`)
    try {
        // Nothing has been edited yet, so a child that exits now is answering the command line rather
        // than failing at the app — and its answer is the supervisor's. The alternative is a `abide
        // dev` in the wrong directory that sits there watching an empty tree.
        const nothing = await abide(['dev'], { cwd: empty })
        expect(nothing.code).toBe(2)
        expect(nothing.err).toContain('no app here')
    } finally {
        await rm(empty, { recursive: true, force: true })
    }
}, 30_000)
