/*
RPC module — every file under src/rpc/ exposes exactly one verb-bound remote
function. The filename is the export name and the URL path (under `/rpc/`),
and the `handler.<VERB>` method picks the HTTP verb. `handler.GET<Args, Return>`
gives the function its type signature; the bundler swaps the runtime per
build target: direct call on the server, fetch over the network on the
client.

Generic parameters are <Args, Return> — Args is what the caller passes in,
Return is the JSON-decoded body type.
*/
import { handler } from 'belte/rpc/handler'

export const getHello = handler.GET<undefined, { message: string }>(() =>
    Response.json({ message: 'Hello from belte' }),
)
