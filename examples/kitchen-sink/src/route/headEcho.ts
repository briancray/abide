import { HEAD } from 'belte/route'

/*
HEAD — same routing semantics as GET, but no response body. Useful for
existence-check / Last-Modified probes. The framework adds the headers
set here on the way out, but never the body.
*/
export const headEcho = HEAD<undefined, undefined>(() => {
    return new Response(undefined, {
        status: 204,
        headers: {
            'x-echo': 'HEAD',
            'Cache-Control': 'no-store',
        },
    })
})
