import type { Socket } from '../../../shared/types/Socket.ts'

/*
Manifest of socket-name → module loader. Produced by the resolver
plugin from each `.ts` under src/server/sockets/. Each module has exactly one
named export, a Socket whose `.name` was stamped in by the bundler
rewrite. The dispatcher imports a module on first access and caches the
resolved Socket against its name.
*/
export type SocketRoutes = Record<string, () => Promise<Record<string, Socket<unknown>>>>
