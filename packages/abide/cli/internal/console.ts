// The app's own console — `abide console`, and the whole of what a compiled binary does when you run
// it.
//
// A console in the sense `rails console` means it: a prompt onto one running system, with a small
// vocabulary of its own and everything else being whatever that system provides. Here the system is
// one abide app and its commands are the endpoints it declares — so the surface is not written down
// in this file at all, it is fetched.
//
// Not `index.ts`'s `cli(argv)`, which is this BINARY's dispatch — that one answers `dev`, `build`,
// `compile` and the rest, and this answers whatever the app does. Not `abide repl` either: that is a
// JavaScript prompt with the isomorphic surface in scope, and this one has no JavaScript in it. And
// not `shell.ts` beside it, which is what the framework has always called a DOCUMENT.
//
// `abide console` reaches it without a compile; `./app` is the same function with the app already
// inside the process.
//
// One surface, two shapes. `app getUser --id=1` is one call and an exit code, which is what a script
// and a deploy hook need; `app` with nothing after it is a prompt, which is what a person poking at
// a running system needs. Neither is a different program: the same line is parsed the same way and
// runs the same code, so anything you learn at the prompt is a command you can paste into a script.
//
// What can be typed is the app's OWN surface plus a handful of actions — `connect`, `disconnect`,
// `serve`, `health`, `identity`, `logs`. The app's half is not compiled in: it is read from
// `GET /__abide/schema`, the catalogue every abide app already publishes, so this drives an app it
// was never built with, and a binary that is a version behind still speaks to what is deployed. That is also what makes the argument shapes real — `--id=1` is decoded by the
// schema the endpoint declared, not by a guess about what a number looks like.
//
// A bare `app` RESUMES: the app it last connected to, or the port it last served on. This is used the
// way a shell is, and being asked to say where you are every time you open one is what makes a tool
// feel like a form to fill in.

import { messageOf } from '#shared/internal/probes.ts'
import type { EndpointShape } from '#shared/internal/shapes.ts'
import { appName, useAppNameSource } from '#shared/log.ts'
import { CLI_EXIT_CODES } from '../CLI_EXIT_CODES.ts'
import { CLIENT_DIR, type ClientManifest } from '../CLIENT_BUILD.ts'
import { ACTIONS, actionNamed, usage } from './ACTIONS.ts'
import { clientAssets, embeddedClient, type LoadedClient } from './assets.ts'
import { call } from './calls.ts'
import { suggest } from './editor.ts'
import type { AppImage } from './layers.ts'
import { assemble } from './layers.ts'
import { BOLD, colored, DIM, paint } from './paint.ts'
import { piped, prompted } from './prompt.ts'
import { embeddedPublics } from './publics.ts'
import { answering, Session } from './session.ts'

/**
 * An app as `abide compile` wrote it into a binary — what the generated entry hands back here.
 *
 * Plain data and thunks, deliberately: everything in it is something the compile ANSWERED (which
 * files are pages, what `app.html` says, where each embedded asset landed), so the generated text is
 * a table rather than a program. Turning it into what `assemble` takes is this file's job, which is
 * what keeps the two static layers' construction — `embeddedClient`, `embeddedPublics` — out of a
 * file nobody reads.
 */
export interface BinaryImage extends Omit<AppImage, 'publics'> {
    /** What this app is called, so `appName()` answers in a process with no package.json to climb to. */
    name: string
    /** The manifest `abide build` wrote, and where each of its files was embedded. */
    client: { manifest: ClientManifest; paths: Record<string, string> } | null
    /** Address → where that public file was embedded. `null` for an app with no public directory. */
    publics: Record<string, string> | null
}

/**
 * `abide console` — the same console, against the app in the working directory.
 *
 * Not named `console`, which is the global every line below writes through. The one place in this
 * package where a name is chosen around a collision rather than for itself.
 */
export async function runConsole(argv: string[]): Promise<number> {
    const root = process.cwd()
    const label = 'abide console'
    const session = new Session(
        appName(),
        async () => {
            // The build if there is one, exactly as `abide start` reads it. An app with no build
            // still serves its endpoints, which is the half of it this is for — so a missing bundle
            // is not a refusal here the way it is there.
            let built: LoadedClient | null = null
            try {
                built = await clientAssets(root)
            } catch (failure) {
                console.error(`${label}: ${CLIENT_DIR} is there and cannot be read — ${messageOf(failure)}`)
                return CLI_EXIT_CODES.failed
            }
            return await assemble({ root, label, client: built })
        },
        label,
    )
    return await driven(session, argv)
}

/** What a compiled binary runs. The app is already in this process; everything else is the same. */
export async function binary(image: BinaryImage, argv: string[]): Promise<number> {
    // Only consulted when `ABIDE_APP_NAME` is unset, so an operator still names it — this is the
    // floor a binary has instead of the package.json climb it cannot make.
    useAppNameSource(() => image.name)
    const session = new Session(
        image.name,
        async () =>
            await assemble({
                // The working directory is still where an app's own relative paths resolve — a data
                // file, a certificate. Nothing abide reads is under it any more.
                root: process.cwd(),
                label: image.name,
                client:
                    image.client === null ? null : embeddedClient(image.client.manifest, image.client.paths),
                image: {
                    app: image.app,
                    entry: image.entry,
                    endpoints: image.endpoints,
                    pages: image.pages,
                    publics: image.publics === null ? null : embeddedPublics(image.publics),
                },
            }),
        image.name,
    )
    return await driven(session, argv)
}

/**
 * Arguments in, exit code out — the half both faces share.
 *
 * Nothing before this point has bound a socket or fetched anything, and that matters: `app --help`
 * and a mistyped action must not be what starts an app.
 */
async function driven(session: Session, argv: string[]): Promise<number> {
    const first = argv[0]
    if (first === '-h' || first === '--help') {
        console.log(await usage(session))
        // `usage` asks the app for the second half of the screen, and asking is what binds the
        // carried one. Stopped rather than left to the process exit, so `onStop` runs.
        if (session.serving) await session.close()
        return CLI_EXIT_CODES.ok
    }
    // Where this was last pointed, in BOTH lanes: a `connect` that only the prompt honoured
    // would mean one-shot calls quietly went somewhere else.
    await resumed(session, first === undefined)
    if (first !== undefined) return await once(session, argv)

    if (process.stdin.isTTY !== true) return await scripted(session)
    return await interactive(session)
}

/** One command — and the one that does not RETURN, which is what makes `app serve` a server. */
async function once(session: Session, argv: string[]): Promise<number> {
    const code = await ran(session, argv)
    if (actionNamed(argv[0] as string)?.holds === true && code === CLI_EXIT_CODES.ok) {
        // A server command has no number to answer with: the process ends when it is SIGNALLED, and
        // the handler that ends it is `boot`'s. Returning here would exit with a socket listening.
        return await new Promise<number>(() => {})
    }
    // A call that had to bind the carried app to make itself is done with it. Stopped rather than
    // left to the process exit, so the app's `onStop` runs — a one-shot call is still a boot.
    if (session.serving) await session.close()
    return code
}

/**
 * A line, run. The action table first, then the app's own endpoints.
 *
 * A bare LAST SEGMENT resolves when exactly one endpoint ends with it, which is what makes `getUser`
 * work for `users/getUser`. Ambiguity is refused with the candidates rather than resolved by a rule
 * — two endpoints called `getUser` in different directories is a legitimate app, and picking one of
 * them by declaration order would answer a different address depending on which
 * module was imported first.
 */
async function ran(session: Session, argv: string[]): Promise<number> {
    const word = argv[0] as string
    const action = actionNamed(word)
    if (action !== undefined) return await action.run(session, argv.slice(1))

    const catalogue = await session.catalogue()
    if (catalogue === null) return CLI_EXIT_CODES.failed

    const found = resolved(catalogue, word)
    if (found === null) {
        console.error(`${word}: nothing here is called that — \`help\` lists what is`)
        return CLI_EXIT_CODES.usage
    }
    if (Array.isArray(found)) {
        console.error(`${word}: ${found.map((shape) => shape.id).join(', ')} — say which`)
        return CLI_EXIT_CODES.usage
    }
    return await call(session, found, argv.slice(1))
}

/** The endpoint, the candidates when a short name is ambiguous, or `null` for no such thing. */
function resolved(catalogue: EndpointShape[], word: string): EndpointShape | EndpointShape[] | null {
    const ending = `/${word}`
    const short: EndpointShape[] = []
    for (const shape of catalogue) {
        if (shape.id === word) return shape
        if (shape.id.endsWith(ending)) short.push(shape)
    }
    if (short.length === 1) return short[0] as EndpointShape
    return short.length === 0 ? null : short
}

/**
 * Where this was last pointed. A session that has never been pointed anywhere stays local.
 *
 * A remembered CONNECT is an address and is simply honoured. A remembered SERVE is an intention, and
 * what it resumes to depends on whether that app is still up: something answering on the port is the
 * app you started, so this attaches to it rather than trying to bind a port it is holding. Nothing
 * answering is a session that has to start it again — which only the prompt does, because a one-shot
 * call was not asking for a server and the app this binary carries can answer it on a port nobody
 * has to know about.
 */
async function resumed(session: Session, prompt: boolean): Promise<void> {
    const last = await session.resume()
    if (last === null) return
    if (last.did === 'connect') {
        session.point(last.url)
        return
    }
    const at = `http://localhost:${last.port}/`
    if (await answering(at)) {
        session.point(at)
        return
    }
    if (prompt) await session.serve(last.port)
}

/** The prompt. */
async function interactive(session: Session): Promise<number> {
    const colors = colored()
    // Held rather than rebuilt, for the reason `repl.ts` holds its list: `complete` is asked per
    // KEYSTROKE, and `names` allocates an array plus a short name per endpoint. The catalogue's own
    // identity is the invalidation — `connect` and `disconnect` are the only two things that move it.
    let known = session.known
    let candidates = names(session)
    await prompted(
        {
            prompt: promptOf(session),
            banner: banner(session, colors),
            // Asked per KEYSTROKE, so it reads what the session already HAS — a completion must not
            // be the thing that fetches a catalogue or binds a socket.
            complete: (prefix) => {
                if (session.known !== known) {
                    known = session.known
                    candidates = names(session)
                }
                return suggest(prefix, candidates)
            },
            take: async (line) => {
                const said = words(line)
                if (said.length > 0) await ran(session, said)
            },
            done: () => session.leaving,
            after: () => promptOf(session),
        },
        colors,
    )
    if (session.serving) await session.close()
    return CLI_EXIT_CODES.ok
}

/**
 * The same lines from a pipe, a heredoc or a file — no prompt, no editor, the same evaluation.
 *
 * The exit code is the one difference, and it is the same rule `abide repl` follows: a session that
 * was HANDED its input has nobody watching the failures go past, so one that failed ends non-zero.
 * The FIRST failing code rather than the last, because that is the one that says what went wrong.
 */
async function scripted(session: Session): Promise<number> {
    let failed: number = CLI_EXIT_CODES.ok
    await piped(async (line) => {
        const said = words(line)
        if (said.length === 0 || session.leaving) return
        const code = await ran(session, said)
        if (code !== CLI_EXIT_CODES.ok && failed === CLI_EXIT_CODES.ok) failed = code
    })
    if (session.serving) await session.close()
    return failed
}

/**
 * A typed line as its words, with quotes respected.
 *
 * `--q="ada lovelace"` is the case this exists for: a shell would have taken the quotes off before
 * `argv` reached the single-command lane, so a prompt that split on whitespace alone would make the
 * two faces disagree about the same line — which is exactly what "paste it into a script" must not
 * mean. A quote inside a word closes and reopens, as it does in a shell, so `--q=a" "b` is one word.
 */
function words(line: string): string[] {
    const said: string[] = []
    let held = ''
    let open = ''
    let started = false
    for (let i = 0; i < line.length; i++) {
        const ch = line[i] as string
        if (open !== '') {
            if (ch === open) open = ''
            else held += ch
            continue
        }
        if (ch === '"' || ch === "'") {
            open = ch
            started = true
            continue
        }
        if (ch === ' ' || ch === '\t') {
            if (started) said.push(held)
            held = ''
            started = false
            continue
        }
        held += ch
        started = true
    }
    if (started) said.push(held)
    return said
}

/** Every name a completion may offer: the actions, and whatever the session already knows. */
function names(session: Session): string[] {
    const found: string[] = []
    for (const action of ACTIONS) found.push(action.name)
    for (const shape of session.known ?? []) {
        found.push(shape.id)
        // The last segment too, since that is what resolves and therefore what people type.
        const cut = shape.id.lastIndexOf('/')
        if (cut !== -1) found.push(shape.id.slice(cut + 1))
    }
    return found
}

/** The host, so the prompt says which app a line is about. */
function promptOf(session: Session): string {
    return `${session.host ?? session.name}> `
}

function banner(session: Session, colors: boolean): string {
    const title = paint(session.name, BOLD, colors)
    const said = paint(
        `bun ${Bun.version} · ${session.where} · \`help\` for what you can type · ctrl-d to leave`,
        DIM,
        colors,
    )
    return `${title}\n${said}\n`
}
