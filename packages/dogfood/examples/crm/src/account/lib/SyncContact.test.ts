import { expect, test } from 'bun:test'

import { reachable } from '@abide/abide/server'

test('a host is asked once, however many calls ask after it', async () => {
    let probes = 0
    // A host that hangs up on every connection, counting them.
    const billing = Bun.listen({
        hostname: '127.0.0.1',
        port: 0,
        socket: {
            open(socket) {
                probes += 1
                socket.end()
            },
            data() {},
        },
    })
    const origin = `http://127.0.0.1:${billing.port}`
    const answers = []
    for (let call = 0; call < 30; call += 1)
        answers.push(await reachable(origin))
    expect(answers.every((answer) => answer === false)).toBe(true)
    expect(probes).toBe(1)
    billing.stop()
})
