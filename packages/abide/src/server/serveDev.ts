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

// A request in flight, from the worker's point of view: which worker was asked, and what to do
// with the answer. Held on this thread because a worker replaced mid-request answers nothing, and
// the socket waiting on it has to be let go rather than left hanging.
type InFlight = {
    worker: Worker
    settle: (answer: Answer) => void
    fail: (thrown: Error) => void
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
    }

    // 38.16 — THE REPLACEMENT. The old worker is terminated, every socket it could still be
    // answering is force-closed, and the new one is opened. The order matters: a socket closed
    // after the new worker is up is a reload client that reconnects to a server still compiling.
    function replace(): void {
        ready = false
        worker?.terminate()
        for (const [id, waiting] of inFlight) {
            inFlight.delete(id)
            waiting.fail(new Error('abide dev: the app was replaced'))
        }
        for (const socket of sockets) socket.terminate()
        sockets.clear()
        void open()
    }

    await open()

    // 38.4 — THE PROJECT, WATCHED. One recursive watcher over the source root: the pages, the
    // shell, the stylesheets and `ui/public` are all under it, and every one of them is something
    // the worker read at boot.
    let settling: ReturnType<typeof setTimeout> | undefined
    const watcher = watch(options.root, { recursive: true }, () => {
        if (settling !== undefined) clearTimeout(settling)
        settling = setTimeout(replace, SETTLE_MILLISECONDS)
    })

    function ask(request: Request): Promise<Response> {
        const current = worker as Worker
        const id = (nextId += 1)
        return new Promise<Response>((resolve, reject) => {
            const settle = (answer: Answer): void => {
                resolve(
                    new Response(answer.body, {
                        status: answer.status,
                        headers: answer.headers,
                    }),
                )
            }
            inFlight.set(id, { worker: current, settle, fail: reject })
            void forward(current, id, request)
        })
    }

    // A REQUEST AS A MESSAGE. `Request` does not survive a structured clone, so what crosses is
    // the four things the worker rebuilds one from — and the body is collected here rather than
    // streamed, which is what the transport costs and the reason `abide start` is the arm any
    // streaming claim is measured against.
    async function forward(
        current: Worker,
        id: number,
        request: Request,
    ): Promise<void> {
        const body = request.body === null ? null : await request.arrayBuffer()
        current.postMessage(
            {
                kind: 'request',
                id,
                method: request.method,
                url: request.url,
                headers: [...request.headers.entries()],
                body,
            },
            body === null ? [] : [body],
        )
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

    // THE WATCHER IS NOT UNREFFED. It holds the process open, which is what a command that IS a
    // server wants: the only ways out of `abide dev` are a signal and a throw, exactly as for
    // `abide start`.
    void watcher

    return server as unknown as Bun.Server<undefined>
}
