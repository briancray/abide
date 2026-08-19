// What the app's console is POINTED AT, and the one thing every line it runs goes through.
//
// A session has exactly two states and they are both an ADDRESS: the app this process carries,
// bound on a socket, or one somebody else is running. That is deliberate and it is the whole design
// — an endpoint is callable in-process, so a process holding the app could reach `getUser({id:1})`
// directly and skip the wire. It does not, because the two doors are not the same call: the wire is
// where the app's middleware onion runs, where the request scope with its cookies and identity is
// installed, where a declared method and a body ceiling are enforced, and where a caller's arguments
// are decoded by the shape the endpoint declared. Skipping all of it would answer a different
// question from the one an operator is asking, and would answer it more often — every refusal an app
// has would be absent.
//
// So the local app is bound on a socket like any other, and the ONLY thing that differs between the
// two states is where the URL points. `serve` names the port; without one, a call binds an ephemeral
// port for the life of the process, which is what makes `./app getUser --id=1` work in a directory
// with nothing running.
//
// The last state is REMEMBERED, because this is used the way a shell is: `./app` with no
// arguments resumes what it did last — the app it connected to, or the port it served on — rather
// than asking again. It lives in the app's own data directory, so two apps do not fight over one
// memory, and an operator who moved that directory has moved this with it.

import { appDataDir } from '#server/app.ts'
import { config } from '#server/config.ts'
import { shutdown } from '#server/lifecycle.ts'
import { under } from '#shared/internal/mount.ts'
import { HEALTH_PATH, SCHEMA_PATH } from '#shared/internal/PATHS.ts'
import { messageOf } from '#shared/internal/probes.ts'
import type { EndpointShape } from '#shared/internal/shapes.ts'
import { CLI_EXIT_CODES } from '../CLI_EXIT_CODES.ts'
import { type Assembly, bind, report } from './layers.ts'

/**
 * Where this remembers what it was pointed at.
 *
 * `appDataDir()` rather than a dotfile of this file's own: it is already the per-user directory this
 * app may write to, already keyed by the app's name, already each platform's own convention, and
 * already movable with `ABIDE_DATA_DIR`. One name inside it, because a session is one fact.
 */
function sessionFile(): string {
    return `${appDataDir()}/session.json`
}

/** What `./app` with no arguments resumes. One or the other, because a session is at one address. */
export type Remembered = { did: 'connect'; url: string } | { did: 'serve'; port: number }

/**
 * One session's worth of state: where it is pointed, and what it has bound.
 *
 * A class rather than closures for the reason the REPL's is one: both lanes drive the same session —
 * a terminal feeds it a line at a time and a pipe feeds it a file — and one place decides what the
 * target IS.
 */
export class Session {
    /** The catalogue of the app currently pointed at, or `null` until something asks. */
    private held: EndpointShape[] | null = null
    private assembled: Assembly | null = null
    private url: string | null = null
    /** `url`'s host, parsed where the url is SET: the prompt asks for it twice per line. */
    private named: string | null = null
    /** True while `url` is a socket THIS process bound, which is what `disconnect` has to stop. */
    private mine = false
    /** Set by `exit`, read by the prompt loop. A session ending is the session's own state. */
    leaving = false

    constructor(
        readonly name: string,
        /** How the app this process carries is assembled, when one is needed. Called at most once. */
        private readonly carried: () => Promise<Assembly | number>,
        private readonly label: string,
    ) {}

    /** What the prompt says, and what a report calls the target. */
    get where(): string {
        if (this.url === null) return 'not connected'
        return this.mine ? `${this.url} (this process)` : this.url
    }

    /** The address, or `null` for a session that has not needed one yet. */
    get address(): string | null {
        return this.url
    }

    /** The host alone — what the prompt is, since a whole url in front of every line is a wall. */
    get host(): string | null {
        return this.named
    }

    /** Whether the app on the other end is the one this process is serving. */
    get serving(): boolean {
        return this.mine
    }

    /**
     * Point at an app somewhere else.
     *
     * Nothing is fetched here: the address is what was asked for, and whether anything answers at it
     * is what the next line finds out — `connect` to a host that is not up yet and then `health` is
     * an ordinary thing to type, and a connect that refused would make it two steps.
     */
    async connect(url: string): Promise<void> {
        await this.close()
        this.point(url)
        await this.remember({ did: 'connect', url })
    }

    /**
     * The same, without writing it down — how a session RESUMES.
     *
     * Split from `connect` because remembering what you were already told is how a memory of an
     * address you have since left gets written back a second time.
     */
    point(url: string): void {
        this.held = null
        this.url = url
        this.named = new URL(url).host
        this.mine = false
    }

    /**
     * Let go of whatever this session is holding: stop a socket it bound, forget an app it was
     * pointed at.
     *
     * One word for both, because it is one question to an operator — what is this talking to, and
     * stop. What it goes back to is the app this process carries, which is where it started.
     */
    async disconnect(): Promise<void> {
        await this.close()
        await this.forget()
    }

    /**
     * Bind the app this process carries, on the port it was asked for.
     *
     * The exit code of a refusal already printed, or `ok`. `report` is the same block `abide start`
     * prints, off the same assembly, so a session that is serving says what it is serving.
     */
    async serve(port: number): Promise<number> {
        const began = performance.now()
        await this.close()
        const bound = await this.open(port)
        if (typeof bound === 'number') return bound
        // No `ctrl-c stops`: this socket is held by a console that is still at its prompt, and Ctrl-C
        // there answers the prompt rather than the server.
        report({ url: bound.url, assembly: bound.assembly, took: performance.now() - began })
        // The port it actually BOUND, not the one it was asked for: `--port 0` is how a caller says
        // "any free one", and remembering the `0` would resume onto a different socket every time.
        const listening = new URL(bound.url).port
        await this.remember({ did: 'serve', port: listening === '' ? port : Number(listening) })
        return CLI_EXIT_CODES.ok
    }

    /**
     * The address to ask, binding the carried app if this session has none.
     *
     * `null` when the app could not be assembled — which has already been reported, because
     * `assemble` prints what an operator has to act on rather than throwing a stack at them.
     */
    async target(): Promise<string | null> {
        if (this.url !== null) return this.url
        // An EPHEMERAL port, and quietly: nobody asked for a server, they asked for a call. `serve` is
        // the same bind with a port somebody named and two lines saying so.
        const bound = await this.open(0)
        return typeof bound === 'number' ? null : bound.url
    }

    /** One request against the target — the whole of how this talks to an app. */
    async ask(path: string, init?: RequestInit): Promise<Response | null> {
        const base = await this.target()
        if (base === null) return null
        const headers = new Headers(init?.headers)
        // A bearer if there is one, for whatever an operator put IN FRONT of the app — the same
        // variable `abide logs` sends, since it is the same question asked of the same deployment.
        const token = config().ABIDE_APP_TOKEN
        if (token !== undefined && !headers.has('authorization'))
            headers.set('authorization', `Bearer ${token}`)
        try {
            return await fetch(under(base, path), { ...init, headers })
        } catch (failure) {
            console.error(`${this.label}: ${base} did not answer — ${messageOf(failure)}`)
            return null
        }
    }

    /**
     * Every endpoint the target declares — the rest of this console's command surface.
     *
     * Held for the life of a target rather than re-fetched per line, because it is what the ghost
     * completion is asked for on every KEYSTROKE. Dropped by `connect` and `disconnect`, which are
     * the only two things that can move it: an app that gained an endpoint while this was pointed at
     * it is a restart away, and `connect` to the same url is how you say so.
     */
    async catalogue(): Promise<EndpointShape[] | null> {
        if (this.held !== null) return this.held
        const answered = await this.ask(SCHEMA_PATH)
        if (answered === null) return null
        if (!answered.ok) {
            console.error(`${this.label}: ${SCHEMA_PATH} answered ${answered.status}`)
            return null
        }
        this.held = (await answered.json()) as EndpointShape[]
        return this.held
    }

    /** The catalogue if it is already here — for a completion, which must not start a fetch. */
    get known(): EndpointShape[] | null {
        return this.held
    }

    /** Leave the prompt. `exit` and Ctrl-D are the same thing said two ways. */
    leave(): void {
        this.leaving = true
    }

    /** What this app's console did last, or `null` for one that has never been pointed anywhere. */
    async resume(): Promise<Remembered | null> {
        try {
            return (await Bun.file(sessionFile()).json()) as Remembered
        } catch {
            // Not there, or not readable, or not JSON any more. A memory that cannot be read is a
            // session that starts fresh — there is nothing here worth refusing to start over.
            return null
        }
    }

    /**
     * Stop a socket this session bound, WITHOUT forgetting where it was pointed.
     *
     * The difference from `disconnect` is the memory, and it is the whole reason both exist: a
     * process on its way out has to run the app's `onStop`, and must not thereby tell the next run
     * that nobody was ever connected. Idempotent, because every caller may be the second.
     */
    async close(): Promise<void> {
        this.held = null
        if (this.mine) await shutdown()
        this.url = null
        this.named = null
        this.mine = false
    }

    /**
     * The carried app on a socket, with the assembly it was built from — or the exit code of a
     * refusal already printed.
     *
     * The assembly comes back rather than being read off the field afterwards because `serve` is the
     * one caller that REPORTS what it bound, and what it says is off the same assembly it bound.
     */
    private async open(port: number): Promise<{ url: string; assembly: Assembly } | number> {
        if (this.assembled === null) {
            const built = await this.carried()
            if (typeof built === 'number') return built
            this.assembled = built
        }
        const bound = await bind(this.assembled, port, this.label)
        if (typeof bound === 'number') return bound
        // `boot` says so on `abide:lifecycle` — an `onStart` that returned without calling `start()`
        // is the app deciding this process should not serve, and there is then nothing to talk to.
        if (bound === null) {
            console.error(`${this.label}: this app's onStart did not start it`)
            return CLI_EXIT_CODES.failed
        }
        this.url = bound.url.href
        this.named = bound.url.host
        this.mine = true
        this.held = null
        return { url: this.url, assembly: this.assembled }
    }

    private async remember(what: Remembered): Promise<void> {
        // A memory that cannot be written is not a failure of the command somebody ran — a read-only
        // home, a container with none. The session works; the next one starts fresh.
        await Bun.write(sessionFile(), `${JSON.stringify(what)}\n`).catch(() => 0)
    }

    private async forget(): Promise<void> {
        await Bun.file(sessionFile())
            .unlink()
            .catch(() => undefined)
    }
}

/**
 * Is an abide app answering here?
 *
 * The health address, because every app has one and it is the cheapest thing to ask — and with a
 * DEADLINE, since the only caller is a resume deciding whether to attach or to start: a probe that
 * hung would make opening a prompt wait out a connect timeout on a port nothing has held for weeks.
 */
export async function answering(base: string): Promise<boolean> {
    try {
        const said = await fetch(under(base, HEALTH_PATH), { signal: AbortSignal.timeout(PROBE_MS) })
        return said.ok
    } catch {
        return false
    }
}

/** Long enough for a loopback answer under load, short enough that nobody watches it fail. */
const PROBE_MS = 1500
