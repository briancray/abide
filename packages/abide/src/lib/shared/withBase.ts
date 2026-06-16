import { basePath } from './basePath.ts'

/*
Prefixes a rooted internal path (`/rpc/…`, `/__abide/…`) with the mount base
so the client's framework requests route through the proxy (`/v2/rpc/…`). The
single rule the runtime fetch sites (remoteProxy, openResolveStream,
socketChannel, the streaming placeholders) share — '' at root is a no-op.
*/
export function withBase(path: string): string {
    return `${basePath()}${path}`
}
