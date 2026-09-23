// 16.29 — A HANDLER, AS A BROWSER HOLDS IT. What a page imported as `getInvoice` is, in the bundle,
// `wire('GET', '/__abide/rpc/invoices/getInvoice')`: the same declaration the server made, over a
// body that fetches rather than one that reads the database. So it is the same `Rpc` — the call
// hands back a `Reactive`, the keyed face narrows by args, a mutation's `ttl` is 0 (16.7), and a
// refusal narrows through `isError` — because it is built by the one `declare` both seams share.
//
// 41.22 — A CALL THE PAGE ALREADY STARTED IS TAKEN, NOT MADE AGAIN. A server-rendered page's early-call
// script (41.21) sent this page's calls while the body was still arriving; the first reach of each
// takes its answer — at once where it has arrived, which lands the value in the same run as
// hydration's setup — and every reach after that fetches, a refresh being a new call.
//
// An entry of its own (`abide/wire`) rather than a name on the runtime barrel: only a generated
// wrapper imports it, and a page with no handler pays nothing for it.

import { EARLY_CALLS } from '#shared/EARLY_CALLS.ts'
import { failed, isFailed } from '#shared/Failed.ts'
import { refuse } from '#shared/refuse.ts'
import { declare, type Method } from '#shared/rpc.ts'
import { type RpcRequest, rpcRequest } from '#shared/rpcRequest.ts'

// What the early-call script leaves per call: the request in flight, and once it has answered, the
// status and the text. `failed` where the request itself did not complete.
type Early = {
    promise: Promise<void>
    status: number | undefined
    statusText: string | undefined
    text: string | undefined
    failed: boolean
}

export function wire(method: Method, address: string): unknown {
    // ONE PARAMETER, so the value is keyed by args whatever the handler declared (16.6's arity rule):
    // an unkeyed handler is reached with no args, which is one key.
    return declare(method)((args: Record<string, unknown> | undefined) => {
        const request = rpcRequest(method, address, args)
        const started = (
            globalThis as unknown as Record<
                string,
                Record<string, Early | undefined> | undefined
            >
        )[EARLY_CALLS]
        const early = started?.[request.key]
        if (early === undefined) return fetched(request)
        ;(started as Record<string, Early | undefined>)[request.key] = undefined
        if (early.text !== undefined) return answered(early)
        return early.promise.then(() =>
            early.failed || early.text === undefined
                ? fetched(request)
                : answered(early),
        )
    })
}

async function fetched(request: RpcRequest): Promise<unknown> {
    const answer = await fetch(
        request.url,
        request.body === undefined
            ? { method: request.method }
            : {
                  method: request.method,
                  headers: { 'content-type': 'application/json' },
                  body: request.body,
              },
    )
    return answered({
        status: answer.status,
        statusText: answer.statusText,
        text: await answer.text(),
    })
}

// What the body hands back: the value, nothing (16.32), or the refusal it was answered with (15.1),
// rebuilt as the `Failed` the server returned. RETURNED, so the value refuses (15.5) rather than
// failing the way a network error does.
function answered(answer: {
    status: number | undefined
    statusText: string | undefined
    text: string | undefined
}): unknown {
    const status = answer.status ?? 0
    if (status === 204) return undefined
    let body: unknown
    try {
        body = answer.text === '' ? undefined : JSON.parse(answer.text ?? '')
    } catch {
        body = undefined
    }
    if (status >= 200 && status < 300) return body
    if (isFailed(body))
        return failed(body.name, body.status, body.message, body.data)
    return refuse(status, answer.statusText || undefined)
}
