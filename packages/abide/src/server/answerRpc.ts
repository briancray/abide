// 16.2 — A HANDLER, ANSWERED OVER HTTP. The call is the in-process one (`#shared/rpc.ts`), made in a
// request's own scope (11.32), and what this module adds is the transport either side of it: the
// args off the request, and the answer onto a response.
//
// NOT HERE YET, each with the clause it waits on: coercing a query's text to the declared type
// (19.8), so a `GET` arg arrives as the string the URL carried; the rungs and `ctx.args()` (16.12,
// 16.13); `timeout` (16.23); the `Origin` gate, `maxBodySize` and the preflight (16.14, 16.25); a
// stream's framing (16.33), so a generator handler is answered once it has finished, as the array
// its value is; and 16.34's framing of what the seed buffer holds, which waits on the same.

import { type Failed, isFailed } from '#shared/Failed.ts'
import { notFound, refuse } from '#shared/refuse.ts'
import type { Method } from '#shared/rpc.ts'
import { argsInURL } from '#shared/rpcRequest.ts'
import { callerOf } from './callerOf.ts'
import { inScope, response } from './requestScope.ts'
import { type Outcome, outcomeOf, takeSeed } from './seedBuffer.ts'

// One row of the table the build writes to `<out>/rpc.ts`: where a handler answers, and where its
// module is — relative to the app's root, which both commands that serve already know.
export type Mount = {
    address: string
    method: Method
    source: string
    name: string
}

export type Mounted = {
    method: Method
    handler: (args?: unknown) => unknown
}

// Each mounted handler's address, by the handler itself — what a page's render needs to turn a call
// it made into the request the browser will make for it (41.21). A `WeakMap` because the handler is
// the module's, and the module is the process's.
const ADDRESSES = new WeakMap<object, Mount>()

export function addressOf(handler: object): Mount | undefined {
    return ADDRESSES.get(handler)
}

// The table, as addresses to what answers them — imported from the SOURCE tree, so a page rendering
// on the server and a call over the wire reach one module and so one handler. AT BOOT rather than
// on the first call, because a page's render reaches a handler through the page's own import and
// has to know its address before anything has called it over the wire.
export async function mountHandlers(
    table: Mount[],
    root: string,
): Promise<Map<string, Mounted>> {
    const modules = await Promise.all(
        table.map(
            (mount) =>
                import(
                    Bun.pathToFileURL(`${root}/${mount.source}`).href
                ) as Promise<Record<string, (args?: unknown) => unknown>>,
        ),
    )
    const mounted = new Map<string, Mounted>()
    for (let at = 0; at < table.length; at += 1) {
        const mount = table[at] as Mount
        const handler = (
            modules[at] as Record<string, (args?: unknown) => unknown>
        )[mount.name] as (args?: unknown) => unknown
        ADDRESSES.set(handler, mount)
        mounted.set(mount.address, { method: mount.method, handler })
    }
    return mounted
}

export async function answerRpc(
    handlers: Map<string, Mounted>,
    url: URL,
    request: Request,
): Promise<Response> {
    const pathname = url.pathname
    const found = handlers.get(pathname)
    // 15.7 — no handler at this address AND this method is one refusal, not two.
    if (found === undefined || found.method !== request.method)
        return answered(notFound({ path: pathname, method: request.method }))
    const args = await argsOf(request, url, found.method)
    if (isFailed(args)) return answered(args)
    const handler = found.handler
    // 41.7 — the call a hydrating page makes for what its render already reached is answered from
    // that, and the handler is not run again (41.13).
    const caller = callerOf(request)
    const seeded =
        caller === undefined ? undefined : takeSeed(caller, handler, args)
    return inScope(request, async () => {
        const outcome = await (seeded ?? outcomeOf(handler(args)))
        const answer = answerOutcome(outcome)
        // 21.15 — HOW LONG THE HANDLER TOOK, AND WHICH RUN THIS IS, for the network panel: an answer
        // from the render's run looks exactly like a fresh one otherwise, and the time is the
        // handler's own rather than this request's.
        answer.headers.set(
            'server-timing',
            seeded === undefined
                ? `handler;dur=${outcome.duration.toFixed(1)}`
                : `handler;dur=${outcome.duration.toFixed(1)};desc="answered from the render's run"`,
        )
        return answer
    })
}

function answerOutcome(outcome: Outcome): Response {
    if (!outcome.settled) {
        // 16.42 — a refusal at its own status. 16.43 — anything else is the server's fault, and
        // says nothing about itself to the caller: the terminal gets the stack.
        if (isFailed(outcome.error)) return answered(outcome.error)
        console.error(outcome.error)
        return answered(refuse(500))
    }
    const written = response()
    // 16.32 — nothing to say is 204, where the handler wrote no status of its own.
    if (outcome.value === undefined)
        return new Response(null, {
            status: written.status === 200 ? 204 : written.status,
            headers: headersOf(written.headers),
        })
    // 16.31, and 21.10's override of 21.3's default for anything the handler wrote.
    return new Response(JSON.stringify(outcome.value), {
        status: written.status,
        headers: headersOf(written.headers),
    })
}

// 21.3, under whatever the handler wrote through `response` (21.10).
function headersOf(written: Headers): Headers {
    const headers = new Headers({
        'content-type': 'application/json',
        'cache-control': 'private, no-store',
    })
    for (const [name, value] of written) headers.set(name, value)
    return headers
}

// 15.1 — a refusal crosses the wire as the four fields it is, at its own status.
function answered(failure: Failed<string, unknown>): Response {
    return new Response(
        JSON.stringify({
            name: failure.name,
            status: failure.status,
            message: failure.message,
            data: failure.data,
        }),
        { status: failure.status, headers: headersOf(new Headers()) },
    )
}

// 16.19's first half: a `GET` or `DELETE` carries its args in the URL and a mutation in the body.
// A query member given more than once is a list; one given once is its text (19.8 is the coercion).
async function argsOf(
    request: Request,
    url: URL,
    method: Method,
): Promise<unknown | Failed<'HttpError', undefined>> {
    if (argsInURL(method)) {
        const query = url.searchParams
        if (query.size === 0) return undefined
        const args: Record<string, string | string[]> = {}
        for (const name of new Set(query.keys())) {
            const values = query.getAll(name)
            args[name] = values.length === 1 ? (values[0] as string) : values
        }
        return args
    }
    const text = await request.text()
    if (text === '') return undefined
    // 16.21 — a body that is not an `Args` is the caller's fault.
    let parsed: unknown
    try {
        parsed = JSON.parse(text)
    } catch {
        return refuse(400, 'The request body is not JSON.')
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
        return refuse(400, 'The request body is not an object of args.')
    return parsed
}
