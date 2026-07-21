// CLIENT SOCKETS — end-to-end swap (client-sockets.md CS3/CS5/CS6/CS7). A `.abide` page importing a
// socket from `server/sockets/<name>.ts` reads the REAL isomorphic `Socket` off `$scope` during SSR
// (the same module-swap RPCs use), and the client bundle ships the socket's spec so the browser proxy
// takes over on hydrate. Covers: SSR reads a socket probe, SSR `{#for await}` renders the tail and
// COMPLETES (never hangs), the bundle carries SOCKET_SPECS, and a non-browser socket import is a build
// error.

import { expect, test } from 'bun:test'
import { createTestApp } from '../test/createTestApp.ts'
import { buildClient } from './internal/clientBundle.ts'
import type { AppConfig } from './internal/router.ts'
import { socket } from './socket.ts'

test('SSR reads a socket probe off $scope (peek renders the latest published message)', async () => {
    const chat = socket<string>({ tail: 5 })
    chat.publish('newest')
    const app = createTestApp({
        sockets: { chat },
        pages: {
            '/': "<script>import { chat } from '../server/sockets/chat.ts'</script><p>{chat.peek()}</p>",
        },
    })
    const body = await (await app.fetch('/')).text()
    expect(body).toContain('newest')
    await app.stop()
})

test('SSR {#for await} over a socket renders the tail snapshot and COMPLETES (CS5, no hang)', async () => {
    const feed = socket<string>({ tail: 3 })
    feed.publish('a')
    feed.publish('b')
    const app = createTestApp({
        sockets: { feed },
        pages: {
            '/': "<script>import { feed } from '../server/sockets/feed.ts'</script><ul>{#for await m of feed}<li>{m}</li>{/for}</ul>",
        },
    })
    // If the socket iterated LIVE under SSR this render would never resolve; snapshot-then-complete
    // makes it finish with the tail painted inline.
    const body = await (await app.fetch('/')).text()
    // Interpolation `{m}` leaves a trailing `<!---->` anchor inside each `<li>`.
    expect(body).toContain('<li>a')
    expect(body).toContain('<li>b')
    await app.stop()
})

test('the client bundle ships SOCKET_SPECS for an imported browser-reachable socket', async () => {
    const config: AppConfig = {
        sockets: { chat: socket<string>({ tail: 4, clientPublish: true }) },
        pages: {
            '/': "<script>import { chat } from '../server/sockets/chat.ts'</script><p>{chat.peek()}</p>",
        },
    }
    const build = await buildClient(config)
    const loader = build.files.get(build.entry) ?? ''
    expect(loader).toContain('SOCKET_SPECS')
    // The spec carries the client-relevant retention/publish knobs (ttl Infinity → null). Bun
    // reformats the emitted JSON literal, so match whitespace-insensitively.
    expect(loader.replace(/\s/g, '')).toContain('chat:{clientPublish:true,tail:4,ttl:null}')
})

test('importing a non-browser-reachable socket into a UI page is a build error (CS6)', async () => {
    const config: AppConfig = {
        sockets: { secret: socket<string>({ clients: { browser: false } }) },
        pages: {
            '/': "<script>import { secret } from '../server/sockets/secret.ts'</script><p>{secret.peek()}</p>",
        },
    }
    await expect(buildClient(config)).rejects.toThrow(/not browser-reachable/)
})
