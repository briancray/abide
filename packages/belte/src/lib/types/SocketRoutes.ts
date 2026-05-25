import type { SocketFunction } from './SocketFunction.ts'

/*
Manifest of socket-route URL → module loader. Produced by the resolver
plugin alongside RemoteRoutes — each `.ts` under src/route/ that uses the
SOCKET helper maps to one URL (file path under `$route`, prefixed with
`/route/`). Each module has exactly one named export, a SocketFunction
whose `.url` was stamped in by the bundler rewrite.
*/
export type SocketRoutes = Record<
    string,
    () => Promise<Record<string, SocketFunction<unknown, unknown>>>
>
