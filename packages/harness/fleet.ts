// One origin, several apps — the front door a sub-path mount has always assumed.
//
// `$shared/internal/mount.ts` states the contract this exists to satisfy: "a sub-path mount is a
// proxy forwarding ONE prefix, and nothing outside that prefix reaches the process at all." An app
// told `APP_URL=http://host/demo/rows` serves everything under `/demo/rows` — its pages, its rpc, its
// `/__abide/` endpoints — and something in front has to put it there. In production that is whatever
// terminates TLS. In dev and under test there was nothing, so a demo could not be a REAL app.
//
// Why a demo has to be a real app rather than a frame written into: measured, twice. A frame filled
// with `document.write` inherits the host page's Content-Security-Policy, so a served document's own
// scripts never run — see `internal/frame.ts`. And a demo that must ship no stylesheet cannot live in
// an app that ships one, because the whole point of the arm is that a class with no rule behind it
// costs no style recalculation. Its own app, its own `app.html`, its own headers.
//
// KNOWS NOTHING ABOUT ANY APP. The table is the caller's — the harness may not reach an app, and a
// prefix table naming one would be exactly that. It takes ports and paths and forwards bytes.
//
// Bun-only, like `spawn.ts` beside it, and for the same reason: there is no front door in a browser.

/** One app, and the prefix it was told it lives under. */
export interface Mounted {
    /** Leading slash, no trailing one — the same normalisation `mountBase()` uses. */
    prefix: string
    port: number
}

export interface FrontDoor {
    port: number
    url: string
    stop(): void
}

/**
 * A door on `port` that forwards by prefix, with everything else going to `fallback`.
 *
 * The path is forwarded UNCHANGED, prefix included, because that is what the app behind it is
 * expecting: it was told where it lives, so it routes on the whole path and writes the whole path
 * into every href it emits. A door that stripped the prefix would be serving an app its own pages
 * under names it does not know.
 *
 * LONGEST PREFIX WINS, so `/demo/rows/deep` reaches `/demo/rows` rather than a `/demo` above it.
 * Sorted once here rather than compared per request.
 *
 * What this does NOT do is upgrade a websocket. An app behind the door serves its pages and its rpc;
 * a socket through it would need the upgrade forwarded, and nothing needs that yet. Named rather than
 * left to be discovered as a demo that mysteriously never receives a message.
 */
export function frontDoor(port: number, table: Mounted[], fallback: number): FrontDoor {
    const routes = [...table].sort((one, two) => two.prefix.length - one.prefix.length)

    const server = Bun.serve({
        port,
        idleTimeout: 60,
        async fetch(request: Request): Promise<Response> {
            const asked = new URL(request.url)
            let to = fallback
            for (const route of routes) {
                if (asked.pathname === route.prefix || asked.pathname.startsWith(`${route.prefix}/`)) {
                    to = route.port
                    break
                }
            }

            const forwarded = new URL(asked.pathname + asked.search, `http://localhost:${to}`)
            const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body
            try {
                const answered = await fetch(forwarded, {
                    method: request.method,
                    headers: request.headers,
                    ...(body === undefined || body === null ? {} : { body, duplex: 'half' }),
                    // MANUAL, so a redirect an app wrote reaches the caller as the app wrote it: the
                    // door following it would answer from a URL the caller never asked for and hide
                    // every `redirect()` this project has a case about.
                    redirect: 'manual',
                } as RequestInit)

                // The two headers that stopped describing the body on the way through. `fetch`
                // DECODES what the app compressed, so passing `content-encoding: gzip` on with the
                // decoded bytes hands the caller plain text and tells it to gunzip — which arrives as
                // a `ZlibError` from a layer that has nothing to do with the door. `content-length`
                // is stale for the same reason.
                const headers = new Headers(answered.headers)
                headers.delete('content-encoding')
                headers.delete('content-length')
                return new Response(answered.body, {
                    status: answered.status,
                    statusText: answered.statusText,
                    headers,
                })
            } catch (error: unknown) {
                // The app behind the prefix is not up. A 502 with the reason on it, because the
                // alternative is a thrown fetch that reads as the DOOR being broken.
                return new Response(`front door: ${forwarded.origin} did not answer — ${String(error)}\n`, {
                    status: 502,
                    headers: { 'content-type': 'text/plain; charset=utf-8' },
                })
            }
        },
    })

    // `server.port` is optional in Bun's types because a `0` binds whatever is free. The door is
    // always given one explicitly, so falling back to it is the same number by a shorter road.
    const bound = server.port ?? port
    return {
        port: bound,
        url: `http://localhost:${bound}`,
        stop(): void {
            server.stop(true)
        },
    }
}
