import type { SocketFunction } from '../types/SocketFunction.ts'
import type { SocketHandler } from '../types/SocketHandler.ts'

/*
Builds a SocketFunction from a flat route URL + an async-generator handler.
The bundler rewrites every `export const NAME = SOCKET(fn)` inside an
`$route/**` module so the URL (from the file path under `src/route/`, with
`/route/` prefix) is threaded into defineSocket.

The plain call returns the handler's AsyncIterable directly — server-side
callers (SSR, in-process publishers) can iterate it just like the browser
does, only without the wire layer in between. `.dispatch` is the hook the
framework's socket dispatcher uses to invoke the handler from an incoming
client frame; it's identical to the plain call today but kept as a named
seam so the dispatch path can layer on context (request id, auth header
echo, etc.) without breaking direct callers.
*/
export function defineSocket<Args, Frame>(
    url: string,
    handler: SocketHandler<Args, Frame>,
): SocketFunction<Args, Frame> {
    function callable(args: Args): AsyncIterable<Frame> {
        return handler(args)
    }
    callable.url = url
    callable.stream = (args: Args): AsyncIterable<Frame> => handler(args)
    callable.dispatch = (args: Args): AsyncIterable<Frame> => handler(args)
    return callable as SocketFunction<Args, Frame>
}
