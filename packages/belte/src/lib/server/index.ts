/*
Public umbrella for everything a belte app's server-side code can touch:
HTTP-verb rpc helpers (rewritten by the bundler inside `src/server/rpc/`), the
isomorphic socket declarator (rewritten by the bundler inside
`src/server/sockets/`), the Response helpers handlers return, the per-call
`request()` accessor, and the `server()` singleton facade.

User code:
  import { GET, json, socket, request } from 'belte/server'

Bundler-emitted stubs reach for `defineVerb` / `defineSocket` /
`remoteProxy` / `socketProxy` directly via per-grouping deep imports —
those impls are intentionally not part of this umbrella.
*/
export { DELETE, GET, HEAD, PATCH, POST, PUT } from './rpc/verbs.ts'
export { socket } from './sockets/socket.ts'
export { error } from './respond/error.ts'
export { HttpError } from './respond/HttpError.ts'
export { json } from './respond/json.ts'
export { jsonl } from './respond/jsonl.ts'
export { redirect } from './respond/redirect.ts'
export { sse } from './respond/sse.ts'
export { request } from './runtime/request.ts'
export { server } from './runtime/server.ts'
export type { AppModule } from './runtime/types/AppModule.ts'
