import type { InspectorContext } from '@abide/abide/server/InspectorContext'
import { createEventBuffer } from './createEventBuffer.ts'
import { eventStreamResponse } from './eventStreamResponse.ts'
import { inspectorHtml } from './inspectorHtml.ts'

/* Records retained for replay to a freshly-connected feed — a tail, not a log store. */
const BUFFER_CAPACITY = 1000

/*
The entry core dynamically imports when ABIDE_ENABLE_INSPECTOR=true. Wires the
framework's log tap into a bounded buffer and returns the request handler core
routes for the inspector's paths. Routes off the mounted root: `/events` (SSE
live feed), `/surface` (the static catalog), `/cache` + `/inflight` (point-in-
time snapshots), everything else the UI page. Suffix-matched so the handler is
agnostic to the mount root and any APP_URL base.
*/
export function mountInspector(context: InspectorContext) {
    const buffer = createEventBuffer<unknown>(BUFFER_CAPACITY)
    context.onRecord((record) => buffer.push(record))
    const page = inspectorHtml(context.app.name, context.app.version)

    return async (request: Request, url: URL): Promise<Response> => {
        if (url.pathname.endsWith('/events')) {
            return eventStreamResponse(buffer, request.headers.get('Last-Event-ID') ?? undefined)
        }
        if (url.pathname.endsWith('/surface')) {
            return Response.json(await context.loadSurface(), {
                headers: { 'Cache-Control': 'no-store' },
            })
        }
        if (url.pathname.endsWith('/cache')) {
            return Response.json(context.cacheSnapshot(), {
                headers: { 'Cache-Control': 'no-store' },
            })
        }
        if (url.pathname.endsWith('/inflight')) {
            return Response.json(context.inFlightSnapshot(), {
                headers: { 'Cache-Control': 'no-store' },
            })
        }
        return new Response(page, {
            headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
        })
    }
}
