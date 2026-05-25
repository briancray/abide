import type { RemoteFunction } from '../types/RemoteFunction.ts'
import type { RemoteHandler } from '../types/RemoteHandler.ts'
import type { SocketFunction } from '../types/SocketFunction.ts'
import type { SocketHandler } from '../types/SocketHandler.ts'

/*
Declares a remote handler inside an `$rpc/**` module. Each file contains
exactly one export, named after the file (e.g. `getUser.ts` →
`export const getUser = ...`). The verb is the import you use: `GET(fn)`,
`POST(fn)`, etc. The bundler reads the export name from the filename, the
verb from the call expression, and the URL from the file path under
`src/rpc/`, then rewrites this call to bind all three into the runtime
implementation (defineVerb on the server, remoteProxy on the client).

SOCKET is the streaming counterpart: same file-as-URL convention, but the
handler is an async generator and the call returns an AsyncIterable that
the caller drains with `for await`. The bundler rewrites it to
defineSocket on the server and socketProxy on the client.

The functions here exist only for the type signature; calling one directly
means the bundler plugin didn't process the file, which throws.
*/
function unprocessed<Args, Return>(verb: string): RemoteFunction<Args, Return> {
    throw new Error(
        `[belte] \`${verb}\` was called outside an $rpc module — verb helpers are only valid as the value of \`export const <filename> = ...\` inside a file under src/rpc/`,
    )
}

type VerbHelper = <Args = undefined, Return = unknown>(
    fn: RemoteHandler<Args, Return>,
) => RemoteFunction<Args, Return>

type SocketHelper = <Args = undefined, Frame = unknown>(
    fn: SocketHandler<Args, Frame>,
) => SocketFunction<Args, Frame>

export const GET: VerbHelper = (_fn) => unprocessed('GET')
export const POST: VerbHelper = (_fn) => unprocessed('POST')
export const PUT: VerbHelper = (_fn) => unprocessed('PUT')
export const PATCH: VerbHelper = (_fn) => unprocessed('PATCH')
export const DELETE: VerbHelper = (_fn) => unprocessed('DELETE')
export const HEAD: VerbHelper = (_fn) => unprocessed('HEAD')
export const SOCKET: SocketHelper = (_fn) => {
    throw new Error(
        '[belte] `SOCKET` was called outside an $rpc module — verb helpers are only valid as the value of `export const <filename> = ...` inside a file under src/rpc/',
    )
}
