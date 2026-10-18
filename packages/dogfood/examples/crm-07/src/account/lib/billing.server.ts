let origin: string | undefined

/** Billing on its bad day: it takes the connection and never answers. */
export function billingOrigin(): string {
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
