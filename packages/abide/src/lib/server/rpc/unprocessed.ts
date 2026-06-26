import type { RemoteFunction } from '../../shared/types/RemoteFunction.ts'

/*
Verb helpers (GET / POST / …) are placeholders — the bundler rewrites every
`export const x = GET(fn)` inside `src/server/rpc/<file>.ts` into a call to
defineRpc (server target) or remoteProxy (client target). If a call slips
through, the bundler plugin didn't process the file; throwing here surfaces
that cleanly instead of silently returning undefined.
*/
export function unprocessed<Args, Return>(verb: string): RemoteFunction<Args, Return> {
    throw new Error(
        `[abide] \`${verb}\` was called outside an $rpc module — verb helpers are only valid as the value of \`export const <filename> = ...\` inside a file under src/server/rpc/`,
    )
}
