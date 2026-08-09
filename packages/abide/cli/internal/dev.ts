// `abide dev` — watch the project, and keep a server running against what the files currently say.
//
// ONE process. This thread watches and owns the lifecycle; a worker holds the app, and replacing that
// worker is the reload. A worker rather than a child process because the thing that has to be thrown
// away is a MODULE GRAPH, not an operating system process: a graph is cached by resolved path and
// cannot be evicted, so reloading means discarding a whole isolate — and an isolate is the smallest
// thing that contains one. See `serve.ts`.
//
// Everything a second process would have cost is therefore absent rather than handled. There is no
// stdout to relay and no colour lost to relaying it, no IPC to carry a port back, no exit code to
// forward, no signal to pass down, and no way to leave a server running that outlived whatever was
// supervising it — kill this pid and the socket goes with it, because it is the same pid. A restart
// is a few milliseconds instead of a Bun startup, which is what makes a save-to-reload loop feel like
// one thing rather than two.
//
// The model is deliberately coarse and has one rule: a change means a new worker. There is no
// dependency graph deciding that a css edit "only" needs the client rebuilt. That graph is the thing
// that is wrong at 2am, and the cost of not having it is a few milliseconds.
//
// Argument parsing belongs to the WORKER, all of it. `abide dev --port nope` is refused by the same
// `portFrom` that refuses `abide start --port nope`, in the code that would have bound the socket —
// so there is one answer to what a port is, and this thread reports the code it was handed.

import { watch } from 'node:fs'
import { CLI_EXIT_CODES } from '../CLI_EXIT_CODES.ts'
import { colored, DIM, paint } from './paint.ts'
// The protocol, from the side that declares it. Types only, so the worker's module is not pulled into
// this thread — and a field added there is a field this side stops compiling without.
import type { Asked, Said } from './serve.ts'

/** The app's isolate. Beside this file on disk, so it moves when this file does. */
const WORKER = new URL('./serve.ts', import.meta.url).href

/**
 * How long the tree has to be QUIET before a restart.
 *
 * A save is rarely one event — an editor writes a temp file and renames it, a formatter rewrites on
 * top of that, and a `git checkout` is hundreds at once. Restarting per event would restart a
 * checkout once per file.
 */
const QUIET_MS = 80

/** How long a worker gets to drain before it is taken. Its `onStop` is the app's, and may be slow. */
const DRAIN_MS = 3000

const SIGNALS = ['SIGINT', 'SIGTERM'] as const

/** A worker that is up, and the port it bound. */
interface Live {
    worker: Worker
    port: number
}

export async function dev(argv: string[]): Promise<number> {
    const root = process.cwd()
    const on = colored()
    const said = (text: string): void => console.log(paint(text, DIM, on))

    // The port the last worker actually bound, which every worker after it is pinned to. Pinning is
    // what makes a restart invisible to an open page: the first worker resolves the port the way
    // `abide start` does and may hop, and nothing after it is allowed to move.
    let pinned: number | null = null
    let live: Live | null = null
    let watcher: ReturnType<typeof watch> | null = null
    let closing = false
    let restarting = false
    let queued = false

    const { promise: ended, resolve: settle } = Promise.withResolvers<number>()

    /**
     * Ctrl-C, and the ordinary way this ends.
     *
     * Registered BEFORE the first worker, which is the whole point of it being up here: the worker
     * prints `listening` on the way up, and a developer who reads that line and immediately hits
     * Ctrl-C must not land in a window where the default action still applies — that is a hard kill
     * with no drain, which is exactly what the app's `onStop` exists to prevent.
     *
     * Signals are not delivered to a worker either, so the app's own `onStop` runs because this asks
     * for it: `boot` installs handlers in there and they never fire.
     */
    const close = (): void => {
        if (closing) return
        closing = true
        watcher?.close()
        void (async () => {
            const held = live
            live = null
            if (held !== null) await halt(held.worker)
            settle(CLI_EXIT_CODES.ok)
        })()
    }
    for (const signal of SIGNALS) process.on(signal, close)

    const first = await run(argv, null, said)
    if (typeof first !== 'number') {
        live = first
        pinned = first.port
    }
    // Signalled while it was still coming up. Whatever it got to is torn down with the process, which
    // is a sentence only a single-process design gets to write.
    if (closing) return await ended
    // Nothing has been edited yet, so a worker that refused is answering the command line rather than
    // failing at the app — and its answer is this command's answer. The alternative is an `abide dev`
    // in the wrong directory sitting there watching an empty tree.
    if (typeof first === 'number') return first

    const restart = async (): Promise<void> => {
        // Serialized rather than concurrent: two workers in flight is two of them racing for one
        // port, and the loser's `EADDRINUSE` would hop it somewhere the browser is not looking.
        if (restarting) {
            queued = true
            return
        }
        restarting = true
        do {
            queued = false
            if (live !== null) await halt(live.worker)
            live = null
            if (closing) break
            const next = await run(argv, pinned, said)
            if (typeof next === 'number') {
                // It came up once and this is a crash — an app that throws on boot after an edit is
                // the ordinary case, and it is fixed by the next save. Exiting here would make a typo
                // end the session.
                said('abide dev: the app did not come up — waiting for a change')
            } else {
                live = next
                pinned = next.port
            }
        } while (queued)
        restarting = false
    }

    watcher = watching(root, (path) => {
        said(`abide dev: ${path} changed — restarting`)
        void restart()
    })

    // `close` is the only thing that settles this, and closing the watcher is the first thing it does.
    return await ended
}

/**
 * A worker with the app in it, or the exit code of a refusal it already PRINTED.
 *
 * The handshake is two messages because the worker has to be listening before it is told anything:
 * it says `ready`, and this replies with the argv and the port to land on. `onerror` is the app
 * throwing its way out of an isolate, which is a failure this cannot read a code off — the throw is
 * already on stderr, and what is left to decide is whether to keep the session.
 */
function run(argv: string[], pin: number | null, said: (text: string) => void): Promise<Live | number> {
    return new Promise((settle) => {
        const worker = new Worker(WORKER)
        let done = false
        const once = (answer: Live | number): void => {
            if (done) return
            done = true
            settle(answer)
        }
        worker.onmessage = (event: MessageEvent): void => {
            const heard = event.data as Said
            if (heard.ready === true) worker.postMessage({ argv, bind: pin } satisfies Asked)
            else if (typeof heard.refused === 'number') {
                worker.terminate()
                once(heard.refused)
            } else if (typeof heard.port === 'number') once({ worker, port: heard.port })
        }
        worker.onerror = (event: ErrorEvent): void => {
            // After it is up this is a crash rather than a boot failure, and the session survives it:
            // the watcher is still running, and the next save is what fixes it.
            if (done) said(`abide dev: the app threw — ${event.message}`)
            worker.terminate()
            once(CLI_EXIT_CODES.failed)
        }
    })
}

/**
 * Drain a worker and then take it.
 *
 * `stop` first, because the app's `onStop` is a drain somebody wrote and a dev restart should run it
 * — a connection pool closed on every restart is one whose teardown is tested. Terminated after that
 * regardless, since a hook that hangs must not hang the watcher with it, and because terminating is
 * the only thing that actually discards the module graph.
 */
async function halt(worker: Worker): Promise<void> {
    const drained = Promise.withResolvers<void>()
    worker.onmessage = (event: MessageEvent): void => {
        if ((event.data as Said).stopped === true) drained.resolve()
    }
    // A worker that threw on the way down has still stopped being the thing serving.
    worker.onerror = (): void => drained.resolve()
    worker.postMessage({ stop: true } satisfies Asked)
    const patience = setTimeout(drained.resolve, DRAIN_MS)
    await drained.promise
    clearTimeout(patience)
    worker.terminate()
}

/**
 * The project tree, debounced to one call per quiet moment.
 *
 * The first path of a batch is what is reported, rather than the last or a count: a save is usually
 * one file, and naming it is how somebody notices the restart they did not expect — a formatter
 * writing into a directory they thought was ignored, say.
 */
function watching(root: string, changed: (path: string) => void): ReturnType<typeof watch> {
    let timer: ReturnType<typeof setTimeout> | null = null
    let first = ''
    return watch(root, { recursive: true }, (_event, name) => {
        if (name === null) return
        const path = String(name)
        if (ignored(path)) return
        if (first === '') first = path
        if (timer !== null) clearTimeout(timer)
        timer = setTimeout(() => {
            const batch = first
            first = ''
            timer = null
            changed(batch)
        }, QUIET_MS)
    })
}

/**
 * A path a change to which is not a change to the app.
 *
 * A DOT prefix is the whole rule for directories, and it is the rule rather than a list because the
 * one that matters is `.abide/` — this command never writes there, but `abide build` writes the
 * bundle and `abide check` writes the generated type tree, and neither running in another terminal
 * may restart the server once per file. `.git/` comes free with it, which is what stops a `git
 * status` from being a restart.
 *
 * The leading dot is also what tells `.abide/` apart from `counter.abide`: the build directory and a
 * SOURCE file share the word, and a rule written against the extension would ignore every page in
 * the project.
 *
 * `node_modules/` is the second, and it is named rather than derived because it carries no dot: an
 * install rewrites thousands of files, none of which a running app reads as source.
 *
 * There is no third. The generated sidecars used to need one — `emitFor` wrote `counter.abide.ts`
 * beside `counter.abide`, inside the tree being watched — and moving that tree under `.abide/` is
 * what deleted the rule rather than what made it redundant.
 */
function ignored(path: string): boolean {
    for (const segment of path.split(SEPARATOR)) {
        if (segment.startsWith('.') || segment === 'node_modules') return true
    }
    return false
}

// `fs.watch` reports a path in the platform's own spelling, and this has to cut it the same way.
const SEPARATOR = /[\\/]/
