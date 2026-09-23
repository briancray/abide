// 38.4 — `abide dev`: the project, watched, with the app kept up across every save. What is here
// is the LISTENER and nothing else (38.15): the socket is bound once on this thread and survives
// every reload, so a browser holding a connection open meets a server that is still there when
// the app behind it has been thrown away and rebuilt.
//
// THE COMPILE IS HERE AND THE APP IS THERE. One `TypeSession` then serves every reload, where a
// compiler imported into each new worker cost 4.5 s a save against the 80 ms the compile takes —
// and the clause asks for the APP to be in the worker, which the compiler is not.
//
// 38.16 — A RELOAD IS A NEW WORKER, not a module cache to invalidate. An app leaves things behind
// that no invalidation reaches — a timer, a `share`, a module that ran once — and a worker is the
// one boundary that takes all of them with it. Every live socket is force-closed with it, which
// is also the whole of the reload protocol: the reload client reconnects and reloads, so nothing
// here has a message to send.

import { watch } from 'node:fs' // bun exposes no file watcher of its own

import { compileApp } from '#compiler/compileApp.ts'
import { DEV_ADDRESS } from './CLIENT_BUILD.ts'

export type DevOptions = {
    // The app's source root — the directory `ui/` sits under, and the tree that is watched.
    root: string
    port?: number | undefined
}

// A request in flight: what to do with the answer, and the request itself — because a worker
// replaced mid-request answers nothing, and the ask has to be put to the app that exists.
type InFlight = {
    method: string
    url: string
    headers: [string, string][]
    body: ArrayBuffer | null
    settle: (answer: Answer) => void
}

type Answer = {
    id: number
    status: number
    headers: [string, string][]
    body: ArrayBuffer
}

// How long to wait for the tree to stop moving before rebuilding. A save from an editor is more
// than one event — a write, a rename, an attribute change — and one rebuild per event is three
// workers for one keystroke.
const SETTLE_MILLISECONDS = 25

export async function serveDev(
    options: DevOptions,
): Promise<Bun.Server<undefined>> {
    const inFlight = new Map<number, InFlight>()
    const sockets = new Set<Bun.ServerWebSocket<undefined>>()
    let worker: Worker | undefined
    let ready = false
    let nextId = 0
    // ASKED BEFORE THERE IS ANYONE TO ASK. A replacement terminates the worker and the next one
    // does not exist until its compile finishes, so a request arriving in that window has
    // nowhere to go — posted to the terminated worker it is never answered, and the reader's
    // tab hangs until they give up. It waits here instead.
    const queued: InFlight[] = []

    // The worker, compiled and answering. A compile that threw is sent IN rather than thrown
    // here: 38.4 keeps the app up, so what a failure changes is what the worker serves.
    async function open(): Promise<void> {
        let modules = new Map<string, string>()
        let failure = ''
        try {
            modules = (await compileApp(options.root)).modules
        } catch (thrown) {
            failure = thrown instanceof Error ? thrown.message : String(thrown)
            console.error(`abide dev: ${failure}`)
        }
        const started = new Worker(
            new URL('./devWorker.ts', import.meta.url).href,
        )
        started.onmessage = (event: MessageEvent): void => {
            const message = event.data as { kind: string } & Answer
            if (message.kind === 'ready') {
                ready = true
                return
            }
            if (message.kind !== 'response') return
            const waiting = inFlight.get(message.id)
            if (waiting === undefined) return
            inFlight.delete(message.id)
            waiting.settle(message)
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
        for (const again of inFlight.values()) queued.push(again)
        inFlight.clear()
        void open()
    }

    await open()

    // 38.4 — THE PROJECT, WATCHED. One recursive watcher over the source root: the pages, the
    // shell, the stylesheets and `ui/public` are all under it, and every one of them is something
    // the worker read at boot.
    //
    // IT IS NOT UNREFFED. It holds the process open, which is what a command that IS a server
    // wants: the only ways out of `abide dev` are a signal and a throw, exactly as for
    // `abide start`.
    let settling: ReturnType<typeof setTimeout> | undefined
    watch(options.root, { recursive: true }, () => {
        if (settling !== undefined) clearTimeout(settling)
        settling = setTimeout(replace, SETTLE_MILLISECONDS)
    })

    // A REQUEST AS A MESSAGE. `Request` does not survive a structured clone, so what crosses is
    // the four things the worker rebuilds one from — and the body is collected here rather than
    // streamed, which is what the transport costs and the reason `abide start` is the arm any
    // streaming claim is measured against.
    //
    // COLLECTED ONCE, HERE, rather than inside `forward`: a body can only be read off a
    // `Request` once, and a re-asked request is the second read that is not there.
    async function ask(request: Request): Promise<Response> {
        const body = request.body === null ? null : await request.arrayBuffer()
        return await new Promise<Response>((resolve) => {
            forward({
                method: request.method,
                url: request.url,
                headers: [...request.headers.entries()],
                body,
                settle: (answer) => {
                    resolve(
                        new Response(answer.body, {
                            status: answer.status,
                            headers: answer.headers,
                        }),
                    )
                },
            })
        })
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

    const server = Bun.serve({
        ...(options.port === undefined ? {} : { port: options.port }),
        fetch(request, listening) {
            const asked = new URL(request.url).pathname
            if (asked === DEV_ADDRESS) {
                // NOT WHILE THE APP IS COMPILING. The reload client reads a refusal as "still
                // rebuilding" and retries, which is what keeps a reload from racing the worker
                // it is meant to show.
                if (!ready) return new Response('rebuilding', { status: 503 })
                return listening.upgrade(request)
                    ? undefined
                    : new Response('expected a websocket', { status: 400 })
            }
            return ask(request)
        },
        websocket: {
            open(socket) {
                sockets.add(socket)
            },
            close(socket) {
                sockets.delete(socket)
            },
            // The reload client says nothing; the socket's LIFE is the whole message.
            message() {},
        },
    })

    return server as unknown as Bun.Server<undefined>
}
