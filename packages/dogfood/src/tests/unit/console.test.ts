// The APP's console, as a process — and the binary `abide compile` writes, as a binary.
//
// `cli.test.ts` is the other one and they are not the same subject: that is the abide binary's own
// dispatch — `dev`, `build`, the help screen — and this is `abide console`, whose commands are
// whatever the app under it declares.
//
// Everything here is SPAWNED for the reason that file states: every claim this makes is about a
// process. What it printed, on which stream, and what the shell learned. Two of those claims
// could not be made any other way at all — that a compiled binary carries the whole app with it, and
// that a session remembers where it was pointed after the process that pointed it is gone.
//
// The dogfood app is the subject of the first half and `apps/tiny` of the second. That split is
// deliberate: this app proves the surface against something real — fifty-odd endpoints, a declared
// shape per argument — and the fixture is what a COMPILE is measured against, because the claim
// there is that four layers were embedded rather than anything about scale.
//
// `ABIDE_DATA_DIR` is redirected on every spawn that remembers anything — see `DATA_DIR` below.

import { afterAll, expect, test } from 'bun:test'
import { CLI_EXIT_CODES } from 'abide/cli'
import { abide, addressOf, BINARY, type Ended, ended, LISTENING, reading, spawn } from 'harness/spawn'
import { APP_ROOT, APPS } from '#tests/PATHS.ts'

/** The fixture app: one endpoint, one page, one public file — one of each layer a binary carries. */
const TINY = `${APPS}/tiny`
const TINY_BINARY = `${TINY}/.abide/tinyapp`

/**
 * Where a session is remembered under test.
 *
 * `ABIDE_DATA_DIR` is the app's own per-user directory said out loud, which is where a session is
 * written. Pointed under this app's build directory rather than left at the platform default:
 * a test that used the real one would reach into whatever the developer running it had a console
 * pointed at, and would survive its own run.
 */
const DATA_DIR = `${APP_ROOT}/.abide/console-gate`

const REMEMBERING = { ABIDE_DATA_DIR: DATA_DIR }

/** A working directory with configuration in it that the binary is supposed to ignore. */
const HOSTILE = `${APP_ROOT}/.abide/console-gate-launched-in`

afterAll(async () => {
    await Bun.file(`${DATA_DIR}/session.json`)
        .unlink()
        .catch(() => undefined)
    await Bun.file(`${HOSTILE}/bunfig.toml`)
        .unlink()
        .catch(() => undefined)
})

/** One line against the dogfood app, run to completion. */
function ran(argv: string[]): Promise<Ended> {
    return abide(['console', ...argv], { cwd: APP_ROOT, env: REMEMBERING })
}

/**
 * What the binary answered, out of a stdout it SHARES with the app's own log lines.
 *
 * An app that logs on boot writes to the same stream the answer goes to — which is not a problem to
 * fix, because a log line is what the app chose to print and this console is not the thing that
 * should be swallowing it. So the answer is found rather than assumed to be the whole of stdout:
 * one line of JSON, which is exactly the shape `printed` writes when stdout is not a terminal.
 */
function answered(said: Ended): unknown {
    for (const line of said.out.split('\n')) {
        if (!line.startsWith('{') && !line.startsWith('[')) continue
        try {
            return JSON.parse(line) as unknown
        } catch {
            // A log line in json form starts with `{` too. Not ours, keep looking.
        }
    }
    return null
}

test('the catalogue IS the help: what the app declares is what can be typed', async () => {
    // There is no `endpoints` command, and that is the claim — listing what the app declares is the
    // help screen's second half, and a command printing the same list under another name would be
    // the copy that goes stale.
    const said = await ran(['help'])
    expect(said.code).toBe(CLI_EXIT_CODES.ok)
    // The address AND how its arguments are spelled, which is what makes the list usable as help.
    expect(said.out).toContain('admin/audit/recent --limit=')
    expect(said.out).toContain('catalogue/catalogue')
    // Both halves: this console's own actions come first, off a table rather than off the app.
    expect(said.out).toContain('connect <url>')
})

test('a flag is decoded by the shape the endpoint declared, not by a guess', async () => {
    // `--limit=2` is text on a command line and the handler counts with it. The endpoint declares a
    // number, so `decodeQuery` — the same function the wire runs on a read's query — is what makes
    // it one. With that coercion out, `"2"` crosses and the answer is not two entries.
    const said = await ran(['recent', '--limit=2'])
    expect(said.code).toBe(CLI_EXIT_CODES.ok)
    expect(answered(said)).toEqual({ entries: 2 })
})

test('a declared string stays a string, even when it is spelled like a number', async () => {
    await compiled()

    // The distinguishing case, and the one a console that read flags for itself gets wrong: `42` is
    // what JSON says that text is, and `name: string` is what says it is a name. Both arms answer
    // `hi 42`, so the type is the whole of the difference.
    const said = await ended(spawn([TINY_BINARY, 'greet', '--name=42', '--times=1'], { cwd: '/' }))
    expect(answered(said)).toEqual({ said: 'hi 42', numeric: true, named: true })
}, 300_000)

test('a mutation goes through its own door, with the same arguments', async () => {
    // A POST has no query to carry arguments, so they are coerced HERE and sent as the JSON body —
    // the one place the two doors genuinely differ, and the reason the catalogue is fetched at all.
    const said = await ran(['docs/identity/the-writers-are-the-servers/signIn', '--id=7'])
    expect(said.code).toBe(CLI_EXIT_CODES.ok)
    expect(answered(said)).toEqual({ sealed: '7' })
})

test('a short name resolves when one endpoint ends with it, and is refused when several do', async () => {
    // Two endpoints called `signIn` in different directories is a legitimate app, and picking one by
    // declaration order would answer a different address depending on what was imported first.
    const several = await ran(['signIn'])
    expect(several.code).toBe(CLI_EXIT_CODES.usage)
    expect(several.err).toContain('say which')
    expect(several.err).toContain('docs/identity/the-writers-are-the-servers/signIn')
})

test('a word this app has no answer for is usage, and it is on stderr', async () => {
    const said = await ran(['getNothing'])
    expect(said.code).toBe(CLI_EXIT_CODES.usage)
    expect(said.err).toContain('nothing here is called that')
})

test('a positional argument is refused rather than guessed at', async () => {
    // An endpoint takes ONE args object, so a bare word has no name to travel under. Any rule for
    // inventing one would be a convention the browser lane knows nothing about.
    const said = await ran(['recent', '2'])
    expect(said.code).toBe(CLI_EXIT_CODES.usage)
    expect(said.err).toContain('arguments are named')
})

test('a piped session runs every line, and the first failure is what the shell learns', async () => {
    // Its own spawn rather than the shared helper, for the one thing that helper does not model: a
    // prompt with no terminal is driven by what is fed to its STDIN.
    const said = await ended(
        Bun.spawn(['bun', BINARY, 'console'], {
            stdin: new TextEncoder().encode('recent --limit=1\ngetNothing\nrecent --limit=2\n'),
            stdout: 'pipe',
            stderr: 'pipe',
            cwd: APP_ROOT,
            env: { ...Bun.env, ...REMEMBERING },
        }),
    )

    // Every line ran: the one in the middle that failed did not end the session.
    expect(said.out).toContain('{"entries":1}')
    expect(said.out).toContain('{"entries":2}')
    expect(said.code).toBe(CLI_EXIT_CODES.usage)
})

test('a compiled binary carries the app: it answers its own endpoint from another directory', async () => {
    await compiled()

    // Run from `/`, where nothing of the app's tree is reachable — which is the whole claim.
    const said = await ended(spawn([TINY_BINARY, 'greet', '--name=ada', '--times=2'], { cwd: '/' }))
    expect(said.code).toBe(CLI_EXIT_CODES.ok)
    // The types are the arguments claim: the strings read the same either way, so only these say
    // which values crossed.
    expect(answered(said)).toEqual({ said: 'hi hi ada', numeric: true, named: true })
}, 300_000)

test('a compiled binary takes no configuration from the directory it was launched in', async () => {
    await compiled()

    // Bun autoloads a `bunfig.toml` out of the working directory, and a binary that honoured one is
    // a binary whose behaviour is decided by wherever an operator happened to `cd`. A `preload` is
    // what makes that VISIBLE rather than subtle: with the autoload left on, this exits 1 with
    // `error: preload not found` and the app never starts. It is the same door this repo's own root
    // bunfig would walk happy-dom through, into a server process.
    await Bun.write(`${HOSTILE}/bunfig.toml`, 'preload = ["./ghost.ts"]\n')

    const said = await ended(spawn([TINY_BINARY, 'greet', '--name=ada', '--times=1'], { cwd: HOSTILE }))
    expect(said.err).not.toContain('preload')
    expect(said.code).toBe(CLI_EXIT_CODES.ok)
    expect(answered(said)).toEqual({ said: 'hi ada', numeric: true, named: true })
}, 300_000)

test("a socket is tailed, and the bounds that make a stream a command are the console's", async () => {
    await compiled()

    // A socket never ends, so a console that opened one and waited would be a command with no exit.
    // `--tail` is how many messages are enough and `--wait` is how long to wait for the next — two
    // questions, because a count alone blocks forever on a room nobody publishes to.
    const said = await ended(spawn([TINY_BINARY, 'pulse', '--tail=3', '--wait=1000'], { cwd: '/' }))
    expect(said.code).toBe(CLI_EXIT_CODES.ok)
    expect(said.out.trim().split('\n')).toEqual(['{"n":1}', '{"n":2}', '{"n":3}'])

    // And it is spelled by its ROOM: `input` on a socket is what a client PUBLISHES, which this
    // never does, so listing that would be a line of flags that select nothing.
    const listed = await ended(spawn([TINY_BINARY, 'help'], { cwd: '/' }))
    expect(listed.out).toContain('pulse/pulse [--tail=<n>] [--wait=<ms>]')
}, 300_000)

test('a compiled binary serves the whole app — its pages, its bundle and its public files', async () => {
    await compiled()

    const app = reading([TINY_BINARY, 'serve', '--port', '0'], { cwd: '/' })
    try {
        const base = addressOf(await app.until(LISTENING))

        const page = await fetch(base)
        const html = await page.text()
        expect(page.status).toBe(200)
        expect(html).toContain('tinyapp is compiled')
        // The document is the app's own `app.html`, embedded as text. abide's fallback shell has no
        // such title, so this is what says which of the two was cut.
        expect(html).toContain('<title>tinyapp</title>')

        // The `<script>` the shell wrote names a file in the manifest, and the bytes behind it are in
        // the executable. A binary that embedded the manifest and not the files answers 404 here.
        const script = /<script[^>]+src="([^"]+)"/.exec(html)?.[1]
        expect(script).toBeDefined()
        const chunk = await fetch(new URL(script as string, base))
        expect(chunk.status).toBe(200)
        expect((await chunk.text()).length).toBeGreaterThan(0)

        // The other static layer, whose addresses are whatever the author typed.
        const publicFile = await fetch(new URL('/hello.txt', base))
        expect(publicFile.status).toBe(200)
        expect(await publicFile.text()).toContain('a public file, embedded')
    } finally {
        app.child.kill()
    }
}, 300_000)

test('a session remembers where it was pointed, and the next run talks to THAT app', async () => {
    await compiled()

    // Somewhere nothing is listening. What makes this a gate is that the next call FAILS by naming
    // it: a run that had forgotten would boot the app it carries and answer happily.
    const nowhere = 'http://127.0.0.1:1/'
    await ended(spawn([TINY_BINARY, 'connect', nowhere], { cwd: '/', env: REMEMBERING }))

    const later = await ended(spawn([TINY_BINARY, 'greet', '--name=ada'], { cwd: '/', env: REMEMBERING }))
    expect(later.err).toContain('did not answer')
    expect(later.code).toBe(CLI_EXIT_CODES.failed)

    // And letting go puts it back on the app the binary carries, with no address in the way.
    const letGo = await ended(spawn([TINY_BINARY, 'disconnect'], { cwd: '/', env: REMEMBERING }))
    expect(letGo.code).toBe(CLI_EXIT_CODES.ok)
    expect(letGo.out).toContain(nowhere)

    const after = await ended(
        spawn([TINY_BINARY, 'greet', '--name=ada', '--times=1'], { cwd: '/', env: REMEMBERING }),
    )
    expect(answered(after)).toEqual({ said: 'hi ada', numeric: true, named: true })
}, 300_000)

/**
 * The fixture, compiled — once for the whole file.
 *
 * Held rather than repeated because `abide compile` runs the client build first and three tests want
 * the same executable. A promise rather than a flag: two of them awaiting this must not both start a
 * compile into the same path.
 */
let compiling: Promise<void> | null = null
function compiled(): Promise<void> {
    if (compiling === null) {
        compiling = (async () => {
            const said = await abide(['compile', '--out', '.abide/tinyapp'], { cwd: TINY })
            if (said.code !== CLI_EXIT_CODES.ok) throw new Error(`the fixture did not compile: ${said.err}`)
        })()
    }
    return compiling
}
