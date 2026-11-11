// NAME THE SHARE of a streaming `GET` read over http, against the same streams over one socket —
// both arms hand-written (`vanillaHttpStreams.ts`, `vanillaMuxStreams.ts`), before any of abide's
// machinery is priced against them.
//
// THE COST IS A COUNT, NOT A DURATION. A browser holds ~6 HTTP/1.1 connections per origin, and an
// open stream holds one of them until it ends; at K open streams every other request to the
// origin waits on K/6 of the pool, and at K = 6 it waits forever. So the instrument is a TCP proxy
// in front of each arm counting the connections open at the peak and the bytes each way — no clock.
//
// `bun packages/abide/bench/muxShare.ts [K] [chunks]`

import { codeLinesOf } from './countLines.ts'
import { httpStream, httpStreamServer } from './vanillaHttpStreams.ts'
import { MuxClient, muxStreamServer } from './vanillaMuxStreams.ts'

const STREAMS = Number(process.argv[2] ?? 6)
const CHUNKS = Number(process.argv[3] ?? 100)

type Tally = {
    open: number
    peak: number
    opened: number
    up: number
    down: number
}

/** A TCP proxy to `port` that counts connections and bytes. */
function countingProxy(port: number): {
    port: number
    tally: Tally
    stop(): void
} {
    const tally: Tally = { open: 0, peak: 0, opened: 0, up: 0, down: 0 }
    type Pair = { upstream: Promise<import('bun').Socket<unknown>> | undefined }
    const proxy = Bun.listen<Pair>({
        hostname: '127.0.0.1',
        port: 0,
        socket: {
            open(client) {
                tally.open++
                tally.opened++
                tally.peak = Math.max(tally.peak, tally.open)
                client.data = {
                    upstream: Bun.connect({
                        hostname: '127.0.0.1',
                        port,
                        socket: {
                            data(_server, bytes) {
                                tally.down += bytes.byteLength
                                client.write(bytes)
                            },
                            close() {
                                client.end()
                            },
                        },
                    }),
                }
            },
            async data(client, bytes) {
                tally.up += bytes.byteLength
                ;(await client.data.upstream)?.write(bytes)
            },
            async close(client) {
                tally.open--
                ;(await client.data.upstream)?.end()
            },
        },
    })
    return { port: proxy.port, tally, stop: () => proxy.stop(true) }
}

async function drain(stream: AsyncIterable<unknown>): Promise<number> {
    let read = 0
    for await (const _ of stream) read++
    return read
}

async function httpArm(): Promise<Tally & { read: number }> {
    const server = Bun.serve({ port: 0, fetch: httpStreamServer() })
    const proxy = countingProxy(server.port as number)
    const origin = `http://127.0.0.1:${proxy.port}`
    const streams: Promise<number>[] = []
    for (let at = 0; at < STREAMS; at++)
        streams.push(drain(httpStream(origin, CHUNKS)))
    let read = 0
    for (const each of streams) read += await each
    proxy.stop()
    server.stop(true)
    return { ...proxy.tally, read }
}

async function muxArm(): Promise<Tally & { read: number }> {
    const server = Bun.serve({ port: 0, ...muxStreamServer() })
    const proxy = countingProxy(server.port as number)
    const client = new MuxClient(`ws://127.0.0.1:${proxy.port}/`)
    const streams: Promise<number>[] = []
    for (let at = 0; at < STREAMS; at++)
        streams.push(drain(client.stream(CHUNKS)))
    let read = 0
    for (const each of streams) read += await each
    client.close()
    await Bun.sleep(20)
    proxy.stop()
    server.stop(true)
    return { ...proxy.tally, read }
}

async function linesOf(name: string): Promise<number> {
    return codeLinesOf(await Bun.file(new URL(name, import.meta.url)).text())
}

const http = await httpArm()
const mux = await muxArm()
const rows = [
    [
        'arm',
        'peak conns',
        'conns opened',
        'chunks read',
        'bytes down',
        'bytes up',
        'down/chunk',
        'LOC',
    ],
    [
        'http',
        http.peak,
        http.opened,
        http.read,
        http.down,
        http.up,
        (http.down / http.read).toFixed(1),
        await linesOf('vanillaHttpStreams.ts'),
    ],
    [
        'mux',
        mux.peak,
        mux.opened,
        mux.read,
        mux.down,
        mux.up,
        (mux.down / mux.read).toFixed(1),
        await linesOf('vanillaMuxStreams.ts'),
    ],
]
console.log(`${STREAMS} streams x ${CHUNKS} chunks`)
for (const row of rows)
    console.log(row.map((cell) => String(cell).padStart(12)).join(''))
console.log(
    `share of a browser's 6-connection origin pool the streams hold: http ${Math.min(1, http.peak / 6).toFixed(2)}, mux ${Math.min(1, mux.peak / 6).toFixed(2)}`,
)
