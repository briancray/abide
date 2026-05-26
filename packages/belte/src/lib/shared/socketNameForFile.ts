/*
Translates a socket file path under `src/server/sockets/` into the socket's
identity used on the wire. The name is the file path minus `.ts` so
nested paths (e.g. `orders/new.ts`) become `orders/new`. Sockets don't
need a URL prefix the way rpc routes do — they multiplex over the
framework-owned `/__belte/sockets` ws and are dispatched by name in the
registry, not by HTTP path.
*/
export function socketNameForFile(relativePath: string): string {
    return relativePath.replace(/\.ts$/, '')
}
