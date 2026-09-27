// 38.4 — `abide dev`: the project, watched, with the app kept up across every save. What is here
// is the LISTENER and nothing else (38.15): the socket is bound once on this thread and survives
// every reload, so a browser holding a connection open meets a server that is still there when
// the app behind it has been thrown away and rebuilt.
//
// 18.2 — THE APP'S MUX IS HELD HERE TOO, and its frames relayed: the browser's web socket is bound
// on this thread, tagged with a connection id, and the worker's mux answers each frame through it.
// A reload closes these with the reload client's, and a follower reconnects naming the version it
// holds (18.24), so the rebuilt app sends it only what moved.
//
// THE COMPILE IS HERE AND THE APP IS THERE. The compiler stays loaded on this thread across every
// reload, where a compiler imported into each new worker cost 4.5 s a save against the 80 ms the
// compile takes — and the clause asks for the APP to be in the worker, which the compiler is not.
//
// 38.16 — A RELOAD IS A NEW WORKER, not a module cache to invalidate. An app leaves things behind
// that no invalidation reaches — a timer, a `share`, a module that ran once — and a worker is the
// one boundary that takes all of them with it. Every live socket is force-closed with it, which
// is also the whole of the reload protocol: the reload client reconnects and reloads, so nothing
// here has a message to send.

import { watch } from 'node:fs' // bun exposes no file watcher of its own
import {
    type AppChecker,
    compileApp,
    openChecker,
} from '#compiler/compileApp.ts'
import { formatDiagnosis } from '#compiler/formatDiagnosis.ts'
import { DEV_ADDRESS, SOCKET_ADDRESS } from '#shared/ADDRESSES.ts'
import type { Ask, FromWorker, ToWorker } from './devWorker.ts'
import { MUX_ADMITTED } from './MUX_ADMITTED.ts'
import { SETTLE_MILLISECONDS } from './SETTLE_MILLISECONDS.ts'

export type DevOptions = {
    // The app's source root — the directory `ui/` sits under, and the tree that is watched.
    root: string
    port?: number | undefined
}

// A request in flight: the request itself — because a worker replaced before it answered answers
// nothing, and the ask has to be put to the app that exists (38.25) — and, once its head has come
// back, the stream the body is fed into and the pull waiting on the worker's next chunk (38.36).
type InFlight = Omit<Ask, 'id'> & {
    settle: (response: Response) => void
    stream: ReadableStreamDefaultController<Uint8Array> | null
    pulled: (() => void) | null
    // A failure the worker sent behind a chunk still queued, raised on the pull after it — raising it
    // at once would discard the chunk, which is the markup saying what broke.
    failed: string | null
}

// The worker, spoken to and heard in its own protocol.
type DevWorker = Omit<Worker, 'postMessage' | 'onmessage'> & {
    postMessage(message: ToWorker): void
    onmessage: ((event: MessageEvent<FromWorker>) => unknown) | null
}

type Compiled = { modules: Map<string, string>; failure: string }

// An app-mux socket's data: the id the worker knows its connection by, and what `connectionOf` reads
// off the upgrade. `undefined` on the reload client's.
type Carried =
    | { conn: number; url: string; headers: [string, string][] }
    | undefined

export async function serveDev(
    options: DevOptions,
): Promise<Bun.Server<undefined>> {
    const inFlight = new Map<number, InFlight>()
    // Every socket this listener holds: the reload client's, with no data, and the app mux's, carrying
    // the connection id the worker knows it by.
    const sockets = new Set<Bun.ServerWebSocket<Carried>>()
    const muxed = new Map<number, Bun.ServerWebSocket<Carried>>()
    let nextConnection = 0
    let worker: DevWorker | undefined
    let ready = false
    let nextId = 0
    // ASKED BEFORE THERE IS ANYONE TO ASK. A replacement terminates the worker and the next one
    // does not exist until its compile finishes, so a request arriving in that window has
    // nowhere to go — posted to the terminated worker it is never answered, and the reader's
    // tab hangs until they give up. It waits here instead.
    const queued: InFlight[] = []

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
            return { modules: compiled.modules, failure: '' }
        } catch (thrown) {
            await closeChecker()
            const failure =
                thrown instanceof Error ? thrown.message : String(thrown)
            console.error(`abide dev: ${failure}`)
            return { modules: new Map(), failure }
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

    // The worker, compiled and answering.
    function open({ modules, failure }: Compiled): void {
        // THE ENVIRONMENT AS IT STANDS, `NODE_ENV` included (36.3): a worker left to its default is
        // handed the one this process STARTED with, and never sees what the command set since.
        const started: DevWorker = new Worker(
            new URL('./devWorker.ts', import.meta.url).href,
            { env: process.env as Record<string, string> },
        )
        started.onmessage = ({ data: message }) => {
            if (message.kind === 'ready') ready = true
            else if (message.kind === 'socket-send')
                muxed.get(message.conn)?.send(message.text)
            else answer(started, message)
        }
        worker = started
        started.postMessage({
            kind: 'start',
            root: options.root,
            modules,
            failure,
        })
        // The worker holds every request behind its own compile, so what waited here only had
        // to wait for one to EXIST.
        const waiting = queued.splice(0)
        for (const again of waiting) forward(again)
    }

    // 38.16 — THE REPLACEMENT. The old worker is terminated, every socket it could still be
    // answering is force-closed, and the new one is opened. The order matters: a socket closed
    // after the new worker is up is a reload client that reconnects to a server still compiling.
    //
    // 38.25 — A REQUEST IN FLIGHT IS RE-ASKED rather than failed. Failing it serves a reader a
    // network error for asking while somebody saved, and during a regeneration of a whole docs
    // tree that is every request; re-asked, they wait and get the app the source now says.
    function replace(): void {
        ready = false
        worker?.terminate()
        worker = undefined
        for (const socket of sockets) socket.terminate()
        sockets.clear()
        muxed.clear()
        // 38.38 — one whose head has gone out cannot be answered again, and ends as `abide start`'s does.
        for (const again of inFlight.values()) {
            if (again.stream === null) queued.push(again)
            else {
                again.stream.error(
                    new Error('abide dev replaced the app mid-response'),
                )
                again.pulled?.()
            }
        }
        inFlight.clear()
        if (compiling !== undefined) stale = true
        else compiling = reopen()
    }

    compiling = reopen()
    await compiling

    // 38.4 — THE PROJECT, WATCHED. One recursive watcher over the source root: the pages, the
    // shell, the stylesheets and `ui/public` are all under it, and every one of them is something
    // the worker read at boot.
    //
    // IT IS NOT UNREFFED. It holds the process open, which is what a command that IS a server
    // wants: the only ways out of `abide dev` are a signal and a throw, exactly as for
    // `abide start`.
    let settling: ReturnType<typeof setTimeout> | undefined
    watch(options.root, { recursive: true }, (_event, filename) => {
        checker?.saw(
            filename === null ? undefined : `${options.root}/${filename}`,
        )
        if (settling !== undefined) clearTimeout(settling)
        settling = setTimeout(replace, SETTLE_MILLISECONDS)
    })

    // A REQUEST AS A MESSAGE. `Request` does not survive a structured clone, so what crosses is
    // the four things the worker rebuilds one from — and the request's body is collected here, which
    // is what lets it be asked again of a replacement (38.25). The answer's body streams (38.36).
    //
    // COLLECTED ONCE, HERE, rather than inside `forward`: a body can only be read off a
    // `Request` once, and a re-asked request is the second read that is not there.
    async function ask(request: Request): Promise<Response> {
        const body = request.body === null ? null : await request.arrayBuffer()
        return await new Promise<Response>((resolve) => {
            forward({
                method: request.method,
                url: request.url,
                headers: identityOnly(request.headers),
                body,
                settle: resolve,
                stream: null,
                pulled: null,
                failed: null,
            })
        })
    }

    // 38.39 — ASKED WITHOUT `accept-encoding`, so the app answers uncompressed. A failure after the
    // head is shown as markup appended to the stream (`pull` in the worker), and markup appended to a
    // compressed stream is a stream no browser can decode. Localhost buys nothing from the bytes saved.
    function identityOnly(headers: Headers): [string, string][] {
        const kept: [string, string][] = []
        for (const [name, value] of headers)
            if (name !== 'accept-encoding') kept.push([name, value])
        return kept
    }

    // 38.36, 38.37 — THE HEAD SETTLES THE RESPONSE, and its body pulls one chunk from the worker per
    // read the connection makes: a high-water mark of 0 asks for nothing ahead of the reader.
    function answer(
        from: DevWorker,
        message: Exclude<FromWorker, { kind: 'ready' | 'socket-send' }>,
    ): void {
        const waiting = inFlight.get(message.id)
        if (waiting === undefined) return
        const { id } = message
        if (message.kind === 'head') {
            if (message.empty) {
                inFlight.delete(id)
                waiting.settle(
                    new Response(null, {
                        status: message.status,
                        statusText: message.statusText,
                        headers: message.headers,
                    }),
                )
                return
            }
            const body = new ReadableStream<Uint8Array>(
                {
                    start(controller) {
                        waiting.stream = controller
                    },
                    pull(controller) {
                        if (waiting.failed !== null) {
                            inFlight.delete(id)
                            controller.error(new Error(waiting.failed))
                            return
                        }
                        return new Promise<void>((done) => {
                            waiting.pulled = done
                            from.postMessage({ kind: 'pull', id })
                        })
                    },
                    cancel() {
                        inFlight.delete(id)
                        from.postMessage({ kind: 'cancel', id })
                    },
                },
                { highWaterMark: 0 },
            )
            waiting.settle(
                new Response(body, {
                    status: message.status,
                    statusText: message.statusText,
                    headers: message.headers,
                }),
            )
            return
        }
        const stream = waiting.stream
        const pulled = waiting.pulled
        waiting.pulled = null
        if (stream === null) return
        if (message.kind === 'chunk')
            stream.enqueue(new Uint8Array(message.bytes))
        else if (message.kind === 'end') {
            inFlight.delete(id)
            stream.close()
        } else if (message.kind === 'fail') waiting.failed = message.message
        pulled?.()
    }

    // NOT TRANSFERRED. Handing the buffer over detaches it here, and a request re-asked of the
    // replacement worker would post a body that is no longer there.
    function forward(waiting: InFlight): void {
        if (worker === undefined) {
            queued.push(waiting)
            return
        }
        nextId += 1
        const id = nextId
        inFlight.set(id, waiting)
        worker.postMessage({
            kind: 'request',
            id,
            method: waiting.method,
            url: waiting.url,
            headers: waiting.headers,
            body: waiting.body,
        })
    }

    // THE CHECKER GOES WITH THE COMMAND. It is a process of its own, and an app with no tsconfig
    // holds a temporary project on disk for as long as it is open. The signal is raised again once
    // it is closed, so the command still ends the way that signal ends a process.
    for (const signal of ['SIGINT', 'SIGTERM'] as const)
        process.once(signal, () => {
            void closeChecker().finally(() => process.kill(process.pid, signal))
        })

    const server = Bun.serve<Carried>({
        ...(options.port === undefined ? {} : { port: options.port }),
        // 16.59, as `App.listen` lifts it: the worker behind this is where the ceiling is read.
        maxRequestBodySize: Number.MAX_SAFE_INTEGER,
        async fetch(request, listening) {
            const asked = new URL(request.url).pathname
            if (asked !== SOCKET_ADDRESS && asked !== DEV_ADDRESS)
                return ask(request)
            // 37.3 — THE MUX'S UPGRADE IS ASKED OF THE APP FIRST, whose lane runs in the worker.
            if (asked === SOCKET_ADDRESS && ready) {
                const answered = await ask(request)
                if (answered.status !== MUX_ADMITTED) return answered
            }
            // NOT WHILE THE APP IS COMPILING. The reload client and the browser's mux both read a
            // refusal as "still rebuilding" and retry, which is what keeps a reload from racing
            // the worker it is meant to show.
            if (!ready) return new Response('rebuilding', { status: 503 })
            let data: Carried
            if (asked === SOCKET_ADDRESS) {
                nextConnection += 1
                data = {
                    conn: nextConnection,
                    url: request.url,
                    headers: [...request.headers.entries()],
                }
            }
            return listening.upgrade(request, { data })
                ? undefined
                : new Response('expected a websocket', { status: 400 })
        },
        websocket: {
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
                muxed.set(carried.conn, socket)
                worker?.postMessage({ kind: 'socket-open', ...carried })
            },
            close(socket) {
                sockets.delete(socket)
                const carried = socket.data
                if (carried === undefined) return
                // A socket a reload terminated is the old worker's, and the new one never knew it.
                if (muxed.delete(carried.conn))
                    worker?.postMessage({
                        kind: 'socket-close',
                        conn: carried.conn,
                    })
            },
            // The reload client says nothing; an app socket's frames go to the mux in the worker.
            message(socket, text) {
                const carried = socket.data
                if (carried === undefined) return
                worker?.postMessage({
                    kind: 'socket-message',
                    conn: carried.conn,
                    text: String(text),
                })
            },
        },
    })

    return server as unknown as Bun.Server<undefined>
}
