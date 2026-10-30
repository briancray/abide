// 38.4 — `abide dev`: the project, watched, with the app kept up across every save. What is here
// is the LISTENER and nothing else (38.14): the socket is bound once in this process and survives
// every reload, so a browser holding a connection open meets a server that is still there when
// the app behind it has been thrown away and rebuilt.
//
// 18.1 — THE APP'S MUX IS HELD HERE TOO, and its frames relayed: the browser's web socket is bound
// in this process, tagged with a connection id, and the app's mux answers each frame through it.
// A reload closes these with the reload client's, and a follower reconnects naming the version it
// holds (18.9), so the rebuilt app sends it only what moved.
//
// THE COMPILE IS HERE AND THE APP IS THERE. The compiler stays loaded in this process across every
// reload, where a compiler imported into each new app cost 4.5 s a save against the 80 ms the
// compile takes — and the clause asks for the APP to be in the child, which the compiler is not.
//
// 38.15 — A RELOAD IS A NEW PROCESS, not a module cache to invalidate. An app leaves things behind
// that no invalidation reaches — a timer, a `share`, a module that ran once, and bun's own memory of
// a file it failed to find — and a process is the one boundary that takes all of them with it. Every live socket is force-closed with it, which
// is also the whole of the reload protocol: the reload client reconnects and reloads, so nothing
// here has a message to send.

import { watch } from 'node:fs' // bun exposes no file watcher of its own
import { dirname, resolve } from 'node:path' // bun exposes no path helpers of its own

import {
    type AppChecker,
    compilationOf,
    compileApp,
    openChecker,
} from '#compiler/compileApp.ts'
import { formatDiagnosis } from '#compiler/formatDiagnosis.ts'
import { DEV_ADDRESS } from '#shared/ADDRESSES.ts'

import type { Compilation } from './abideModules.ts'
import { DEFAULT_PORT } from './DEFAULT_PORT.ts'
import type { FromWorker, ToWorker } from './devWorker.ts'
import { IDLE_TIMEOUT_SECONDS } from './IDLE_TIMEOUT_SECONDS.ts'
import { muxSocketOptions, sendOrClose, upgraded } from './muxUpgrade.ts'
import { placeOf } from './placement.ts'
import { plainAnswer } from './plainAnswer.ts'
import { askOver } from './responseRelay.ts'
import { SETTLE_MILLISECONDS } from './SETTLE_MILLISECONDS.ts'

/** What `abide dev` serves, and where. */
export type DevOptions = {
    /**
     * The app's source root — where its pages sit, and the tree that is watched — as its real path
     * (`appRoot`), which is how the bundler names what it built.
     */
    root: string
    port?: number | undefined
}

// The app's process, spoken to in its own protocol.
type DevWorker = {
    postMessage(message: ToWorker): void
    terminate(): void
}

type Compiled = {
    compilation: Compilation
    /** The public files the compile's walk found (`appFiles`), which the worker answers. */
    published: Map<string, string>
    failure: string
}

const LAST_DEV_PORT = 3099

// An app-mux socket's data: the id the worker knows its connection by, and what `Mux.connect` reads
// off the upgrade. `undefined` on the reload client's.
type Carried =
    { connection: number; url: string; headers: [string, string][] } | undefined

/**
 * `abide dev`'s listener, compiling the app here and serving it from a child process.
 *
 * The child is replaced on every save; the listener's bound socket outlives it.
 */
export async function serveDev(
    options: DevOptions,
): Promise<Bun.Server<undefined>> {
    // 38.24, 38.35 — every request, asked of the worker there is and streamed back a chunk per read.
    // 16.23 — a request's idle timeout set on the request bun handed this listener.
    const relay = askOver((request, seconds) =>
        served?.timeout(request, seconds),
    )
    // Every socket this listener holds: the reload client's, with no data, and the app mux's, carrying
    // the connection id the worker knows it by.
    const sockets = new Set<Bun.ServerWebSocket<Carried>>()
    const muxed = new Map<number, Bun.ServerWebSocket<Carried>>()
    let nextConnection = 0
    let worker: DevWorker | undefined
    let ready = false
    let served: Bun.Server<Carried> | undefined

    // ONE COMPILE AT A TIME, and the worker is started from the LAST one. A save landing while a
    // compile runs marks it stale rather than starting a second: two in flight each started a
    // worker, the one finishing second overwrote the first without terminating it, and where the
    // older compile finished last it was the one that served.
    let compiling: Promise<void> | undefined
    let stale = false

    // THE CHECKER IS KEPT ACROSS SAVES, and what the watcher saw move since the last compile is
    // what it is told (`AppChecker.saw`). On the docs app a save reached the next answer in 182 ms
    // opening a checker per compile and 86 ms keeping one; kept, it re-reads only what moved.
    let checker: AppChecker | undefined

    async function reopen(): Promise<void> {
        let compiled: Compiled
        do {
            stale = false
            compiled = await compile()
        } while (stale)
        compiling = undefined
        open(compiled)
    }

    // A compile that threw is sent IN rather than thrown here: 38.4 keeps the app up, so what a
    // failure changes is what the worker serves.
    //
    // A THROW DROPS THE CHECKER. Most are an author's typo, but the checker's own process dying is
    // one too, and a session nobody can tell apart from a dead one is not one to keep.
    async function compile(): Promise<Compiled> {
        try {
            if (checker !== undefined && !checker.current())
                await closeChecker()
            checker ??= await openChecker(options.root)
            const compiled = await compileApp(options.root, checker)
            // 14 and 32.14 — what the compiler has to say, on every compile.
            for (const warning of compiled.warnings)
                console.warn(formatDiagnosis(warning, process.cwd()))
            watchDependencies(compiled.files)
            return {
                compilation: compilationOf(compiled),
                published: compiled.published,
                failure: '',
            }
        } catch (thrown) {
            await closeChecker()
            const failure =
                thrown instanceof Error ? thrown.message : String(thrown)
            console.error(`abide dev: ${failure}`)
            return {
                compilation: {
                    files: {},
                    handlers: {},
                    tables: {},
                },
                published: new Map(),
                failure,
            }
        }
    }

    async function closeChecker(): Promise<void> {
        const closing = checker
        checker = undefined
        try {
            await closing?.close()
        } catch {
            // Already gone, which is what closing it was for.
        }
    }

    // A path a watcher saw move — or a move nobody could name — and the replacement it schedules.
    let settling: ReturnType<typeof setTimeout> | undefined
    function moved(path: string | undefined): void {
        checker?.saw(path)
        if (settling !== undefined) clearTimeout(settling)
        settling = setTimeout(replace, SETTLE_MILLISECONDS)
    }

    // 38.99 — A DEPENDENCY'S `.abide` IS THE APP'S TOO, and a linked package's lies outside the root's
    // watcher: each directory one was compiled from is watched once, for the session.
    const watchedDependencies = new Set<string>()
    function watchDependencies(files: Compilation['files']): void {
        for (const relative of Object.keys(files)) {
            if (placeOf(relative) !== 'dependency') continue
            const directory = dirname(resolve(options.root, relative))
            if (watchedDependencies.has(directory)) continue
            watchedDependencies.add(directory)
            watch(directory, (_event, filename) =>
                moved(
                    filename === null ? undefined : `${directory}/${filename}`,
                ),
            )
        }
    }

    // The worker, compiled and answering.
    function open({ compilation, published, failure }: Compiled): void {
        // 38.14 — A PROCESS, NOT A THREAD, for the header's reason: bun remembers a file it failed
        // to find for the life of the process, and a thread inherits the miss.
        //
        // THE ENVIRONMENT AS IT STANDS, `NODE_ENV` included (36.3): the child is handed what this
        // process holds now rather than what it started with. `advanced` carries an `ArrayBuffer`.
        const child = Bun.spawn(
            [
                'bun',
                Bun.fileURLToPath(new URL('./devWorker.ts', import.meta.url)),
            ],
            {
                env: process.env as Record<string, string>,
                stdio: ['inherit', 'inherit', 'inherit'],
                serialization: 'advanced',
                ipc(message: FromWorker) {
                    if (message.kind === 'ready') {
                        ready = true
                        muxOptions = message.muxOptions
                        served?.reload(serving(undefined))
                    } else if (message.kind === 'socket-send')
                        sendOrClose(muxed.get(message.connection), message.text)
                    else relay.take(message)
                },
                // 38.41 — AN APP THAT EXITS ON ITS OWN is replaced, and says so: a listener still
                // forwarding to it leaves every tab hanging.
                onExit() {
                    if (worker !== started) return
                    console.error(
                        'abide dev: the app exited, so it was restarted',
                    )
                    // 38.41 — the request in hand may be what ended it, so none is asked again.
                    relay.endAll('abide dev: the app exited', false)
                    replace()
                },
            },
        )
        const started: DevWorker = {
            // A message to a process already gone is one nobody would answer; its exit says so.
            postMessage(message) {
                if (!child.killed && child.exitCode === null)
                    child.send(message)
            },
            // 38.96 — SIGTERM, which the worker answers by hanging up what it is answering; a worker
            // wedged in a loop never reads it, so a second later it is killed outright.
            terminate() {
                child.kill()
                setTimeout(() => child.kill('SIGKILL'), 1000).unref()
            },
        }
        worker = started
        started.postMessage({
            kind: 'start',
            root: options.root,
            compilation,
            published,
            failure,
        })
        // The worker holds every request behind its own compile, so what waited for one only had
        // to wait for it to EXIST.
        relay.replace(started)
    }

    // 38.15 — THE REPLACEMENT. The old worker is terminated, every socket it could still be
    // answering is force-closed, and the new one is opened. The order matters: a socket closed
    // after the new worker is up is a reload client that reconnects to a server still compiling.
    //
    // 38.24 — A REQUEST IN FLIGHT IS RE-ASKED rather than failed. Failing it serves a reader a
    // network error for asking while somebody saved, and during a regeneration of a whole docs
    // tree that is every request; re-asked, they wait and get the app the source now says.
    function replace(): void {
        ready = false
        worker?.terminate()
        worker = undefined
        relay.replace(undefined)
        for (const socket of sockets) socket.terminate()
        sockets.clear()
        muxed.clear()
        relay.endAll('abide dev replaced the app mid-response', true)
        if (compiling !== undefined) stale = true
        else compiling = reopen()
    }

    compiling = reopen()
    await compiling

    // 38.4 — THE PROJECT, WATCHED. One recursive watcher over the source root: the pages, the
    // layouts, the stylesheets and every `public` directory are all under it, and every one of them is something
    // the worker read at boot.
    //
    // IT IS NOT UNREFFED. It holds the process open, which is what a command that IS a server
    // wants: the only ways out of `abide dev` are a signal and a throw, exactly as for
    // `abide start`.
    watch(options.root, { recursive: true }, (_event, filename) =>
        moved(filename === null ? undefined : `${options.root}/${filename}`),
    )

    // THE CHECKER AND THE WORKER GO WITH THE COMMAND. Each is a process of its own, and an app with
    // no tsconfig holds a temporary project on disk for as long as the checker is open. The worker
    // is told directly rather than left to its `disconnect`, which a worker busy inside a build
    // reads only when the build lets go — orphaned until then. The signal is raised again once the
    // checker is closed, so the command still ends the way that signal ends a process.
    for (const signal of ['SIGINT', 'SIGTERM'] as const)
        process.once(signal, () => {
            worker?.terminate()
            void closeChecker().finally(() => process.kill(process.pid, signal))
        })

    // 18.28 — THE MUX'S LIMITS ARE THE APP'S CONFIGURATION, and so the worker's to resolve: each
    // worker reports them on `ready` and the listener is reloaded with them, or `abide dev` would
    // hold a socket to a limit `onConfig` moved in production and not here. Bun applies a reload's
    // `maxPayloadLength` to every connection opened after it.
    let muxOptions = muxSocketOptions()
    const serving = (port: number | undefined): Bun.Serve.Options<Carried> => ({
        ...(port === undefined ? {} : { port }),
        // 16.54, as `App.listen` lifts it: the worker behind this is where the ceiling is read.
        maxRequestBodySize: Number.MAX_SAFE_INTEGER,
        // 16.56 — the bound a request received whole lifts and its answer puts back (16.23).
        idleTimeout: IDLE_TIMEOUT_SECONDS,
        async fetch(request, listening) {
            const asked = new URL(request.url).pathname
            // THE MUX STANDS UNDER THE MOUNT, which is the app's configuration and so the worker's to
            // read: every upgrade but the reload client's is asked of it, and the worker says
            // whether it is the mux's (`muxUpgrade`) — a status alone is not, since any rung at any
            // address can answer one.
            const mux =
                asked !== DEV_ADDRESS &&
                request.headers.get('upgrade') === 'websocket'
            if (!mux && asked !== DEV_ADDRESS) return relay.ask(request)
            // 37.3 — THE MUX'S UPGRADE IS ASKED OF THE APP FIRST, whose lane runs in the worker.
            if (mux && ready) {
                const answered = await relay.ask(request)
                if (!relay.admitted(answered)) return answered
            }
            // NOT WHILE THE APP IS COMPILING. The reload client and the browser's mux both read a
            // refusal as "still rebuilding" and retry, which is what keeps a reload from racing
            // the worker it is meant to show.
            if (!ready) return plainAnswer('rebuilding', 503)
            let data: Carried
            if (mux) {
                nextConnection += 1
                data = {
                    connection: nextConnection,
                    url: request.url,
                    headers: [...request.headers.entries()],
                }
            }
            return upgraded(listening, request, data)
        },
        websocket: {
            ...muxOptions,
            open(socket) {
                // A RELOAD LANDED between the upgrade and this open: the worker it was meant for is
                // gone and the next one would never hear of it, so it is closed and retried instead.
                if (!ready) {
                    socket.terminate()
                    return
                }
                sockets.add(socket)
                const carried = socket.data
                if (carried === undefined) return
                muxed.set(carried.connection, socket)
                worker?.postMessage({ kind: 'socket-open', ...carried })
            },
            close(socket) {
                sockets.delete(socket)
                const carried = socket.data
                if (carried === undefined) return
                // A socket a reload terminated is the old worker's, and the new one never knew it.
                if (muxed.delete(carried.connection))
                    worker?.postMessage({
                        kind: 'socket-close',
                        connection: carried.connection,
                    })
            },
            // The reload client says nothing; an app socket's frames go to the mux in the worker.
            message(socket, text) {
                const carried = socket.data
                if (carried === undefined) return
                worker?.postMessage({
                    kind: 'socket-message',
                    connection: carried.connection,
                    text: String(text),
                })
            },
        },
    })
    const listen = (port: number | undefined) =>
        Bun.serve<Carried>(serving(port))

    // 38.64 — A PORT SOMEONE NAMED IS THE PORT, and one taken is the failure. `Bun.serve` given
    // none reads `PORT` itself.
    served =
        options.port !== undefined || process.env.PORT
            ? listen(options.port)
            : listenOnFirstFree(listen)
    return served as unknown as Bun.Server<undefined>
}

// 38.63 — NAMED BY NOBODY, the first free port from 3000. A port taken is the next one tried, and
// any other failure is the failure.
function listenOnFirstFree<Listener>(
    listen: (port: number) => Listener,
): Listener {
    for (let port = DEFAULT_PORT; ; port += 1)
        try {
            return listen(port)
        } catch (thrown) {
            if (
                (thrown as { code?: unknown }).code !== 'EADDRINUSE' ||
                port === LAST_DEV_PORT
            )
                throw thrown
        }
}
