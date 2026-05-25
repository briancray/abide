import type { SocketFunction } from './SocketFunction.ts'

/*
Manifest of socket-rpc URL → module loader. Produced by the resolver
plugin alongside RemoteRoutes — each `.ts` under src/rpc/ that uses the
SOCKET helper maps to one URL (file path under `$rpc`, prefixed with
`/rpc/`). Each module has exactly one named export, a SocketFunction
whose `.url` was stamped in by the bundler rewrite.
*/
export type SocketRoutes = Record<
    string,
    () => Promise<Record<string, SocketFunction<unknown, unknown>>>
>
