// The billing service on its bad day: a host that takes the connection and never answers, so a
// call to it waits out whatever timeout the caller set.

let origin: string | undefined

/** The origin of a billing host that is down, listening from the first ask. */
export function reachableHostBilling(): string {
    if (origin === undefined) {
        const host = Bun.listen({
            hostname: '127.0.0.1',
            port: 0,
            socket: { data() {} },
        })
        origin = `http://127.0.0.1:${host.port}`
    }
    return origin
}
