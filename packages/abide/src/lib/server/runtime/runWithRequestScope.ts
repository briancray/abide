import { abideLog } from '../../shared/abideLog.ts'
import { createCacheStore } from '../../shared/createCacheStore.ts'
import { createTraceContext } from '../../shared/createTraceContext.ts'
import { formatTraceparent } from '../../shared/formatTraceparent.ts'
import { isStreamingResponse } from '../../shared/isStreamingResponse.ts'
import { logClosingRecord } from '../../shared/logClosingRecord.ts'
import type { AppModule } from '../AppModule.ts'
import { inFlightRequests } from './inFlightRequests.ts'
import { internalErrorResponse } from './internalErrorResponse.ts'
import { requestContext } from './requestContext.ts'
import type { RequestStore } from './types/RequestStore.ts'

/*
Establishes the per-request scope and runs `body` inside it: a fresh
CacheStore, the request's trace position and start time, and request metadata
published through the AsyncLocalStorage RequestStore (so cache(), request()/
server(), trace(), and log prefixes resolve without threading args), the
app's handleError — or the framework's 500 fallback — on a thrown body, and
optional request logging. The single seam every dynamic route crosses;
extracted from createServer so the scope, error, and logging behaviour is
exercisable through this interface without booting a Bun server.
*/
export function runWithRequestScope(
    req: Request,
    /* `url` skips the WHATWG re-parse when the caller already parsed it (the fetch fallback). */
    options: { app?: AppModule; logRequests: boolean; url?: URL },
    body: (store: RequestStore) => Promise<Response>,
): Promise<Response> {
    const url = options.url ?? new URL(req.url)
    const store: RequestStore = {
        url,
        req,
        cache: createCacheStore(),
        trace: createTraceContext(req.headers.get('traceparent')),
        start: Bun.nanoseconds(),
    }
    return requestContext.run(store, async () => {
        /* Register the live handler for the inspector's in-flight view; the Set is
           absent (a no-op) unless the inspector mounted. Removed once the handler
           settles — its compute is done even if a streamed body keeps piping. */
        inFlightRequests.tracked?.add(store)
        let response: Response
        try {
            response = await body(store)
        } catch (error) {
            if (options.app?.handleError) {
                response = await options.app.handleError(error, req)
            } else {
                abideLog.error(error)
                response = internalErrorResponse(error)
            }
        } finally {
            inFlightRequests.tracked?.delete(store)
        }
        /*
        Flush any cookies the handler set onto the outgoing response. Only when
        a jar was materialized (cookies() was called) and only via append, so a
        Set-Cookie the handler already placed on the response init survives.
        */
        if (store.cookies) {
            const setCookies = store.cookies.toSetCookieHeaders()
            if (setCookies.length > 0) {
                try {
                    setCookies.forEach((header) => {
                        response.headers.append('set-cookie', header)
                    })
                } catch {
                    /* A passthrough Response (proxied fetch) carries immutable headers;
                       rebuild it with a mutable copy so the cookies still ship rather
                       than the append throwing and 500ing the successful response. */
                    response = new Response(response.body, response)
                    setCookies.forEach((header) => {
                        response.headers.append('set-cookie', header)
                    })
                }
            }
        }
        /*
        Server-Timing is always-on (identical dev/build): `total` is what's
        knowable at header time — for streamed responses the settled total
        belongs to the closing log record — and the `traceparent` entry is the
        one header browsers expose to page JS, so RUM tooling links the
        frontend to this trace. Guarded: a passthrough Response (proxied
        fetch) carries immutable headers.
        */
        const headerMs = (Bun.nanoseconds() - store.start) / 1e6
        const stats = store.cache.stats
        const cacheEntry =
            stats.hits + stats.misses + stats.coalesced > 0
                ? `, cache;desc="hits=${stats.hits} misses=${stats.misses} coalesced=${stats.coalesced}"`
                : ''
        try {
            response.headers.set(
                'server-timing',
                `total;dur=${headerMs.toFixed(1)}, traceparent;desc="${formatTraceparent(store.trace)}"${cacheEntry}`,
            )
        } catch {
            /* Immutable headers — skip; the closing log record still reports. */
        }
        if (!options.logRequests) {
            return response
        }
        /*
        The closing record logs at settle so its elapsed IS the total. Buffered
        responses settle here; streaming bodies (SSE/JSONL) settle when the
        stream ends — re-entered into the request scope because stream
        callbacks don't inherit the ALS context.
        */
        let settled = false
        const emitClose = () => {
            if (settled) {
                return
            }
            settled = true
            requestContext.run(store, () => {
                const ms = (Bun.nanoseconds() - store.start) / 1e6
                /* Copy freezes the tallies at settle — the live object keeps counting if late reads land. */
                logClosingRecord(req.method, `${url.pathname}${url.search}`, response.status, ms, {
                    ...store.cache.stats,
                })
            })
        }
        if (response.body && isStreamingResponse(response)) {
            /*
            A hand-pumped wrap rather than a TransformStream: streams typically
            end by client disconnect (an SSE tab closing), which cancels the
            readable without ever flushing a transform — Bun also skips the
            transformer's cancel hook — so only this readable's own close/error/
            cancel paths see every termination.
            */
            const reader = response.body.getReader()
            const monitored = new ReadableStream({
                async pull(controller) {
                    try {
                        const { done, value } = await reader.read()
                        if (done) {
                            emitClose()
                            controller.close()
                            return
                        }
                        controller.enqueue(value)
                    } catch (error) {
                        emitClose()
                        controller.error(error)
                    }
                },
                cancel(reason) {
                    emitClose()
                    return reader.cancel(reason)
                },
            })
            return new Response(monitored, response)
        }
        emitClose()
        return response
    })
}
