/*
Binds the launcher's in-process control server to the given localhost port,
falling back to a kernel-assigned free port when that port is already taken
(another instance of the same app, or an unrelated process). The stable port
keeps the connect screen's origin — and its localStorage — constant across
launches; the fallback trades that stability for the app still booting. Callers
read the actual port from the returned server's `.port` to build the origin.
*/
export function listenLocalControlServer(
    port: number,
    fetch: (request: Request) => Response | Promise<Response>,
): ReturnType<typeof Bun.serve> {
    try {
        return Bun.serve({ port, hostname: '127.0.0.1', fetch })
    } catch {
        // EADDRINUSE (or any bind failure) on the stable port → take any free one.
        return Bun.serve({ port: 0, hostname: '127.0.0.1', fetch })
    }
}
