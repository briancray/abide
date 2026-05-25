import type { RemoteFunction } from './RemoteFunction.ts'

/*
Manifest of RPC URL → module loader. Produced by the resolver plugin from
every `.ts` under src/route — each file maps to one URL (derived from its
path under `$route`, prefixed with `/route/`). Each module has exactly one
named export, a RemoteFunction whose `.method` and `.url` were stamped in
by the bundler rewrite.
*/
export type RemoteRoutes = Record<
    string,
    () => Promise<Record<string, RemoteFunction<unknown, unknown>>>
>
