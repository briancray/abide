/*
Endpoint file — every export defined with a verb helper is exposed at the
folder's URL (here, /hello) and becomes a typed function callable from any
server or client module. The bundler swaps the implementation per target:
direct call on the server, fetch over the network on the client.

Generic parameters are <Args, Return> — Args is what the caller passes in,
Return is the JSON-decoded body type.
*/
import { GET } from 'belte/route/GET'

export const getHello = GET<undefined, { message: string }>(() =>
    Response.json({ message: 'Hello from belte' }),
)
