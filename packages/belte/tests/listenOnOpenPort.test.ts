import { afterEach, describe, expect, test } from 'bun:test'
import type { Server } from 'bun'
import { listenOnOpenPort } from '../src/lib/server/runtime/listenOnOpenPort.ts'

// Binds a real server on `port`, mirroring how createServer's buildServer is wired.
const bindAt = (port: number): Server<unknown> => Bun.serve({ port, fetch: () => new Response() })

// Bun types Server.port as possibly-undefined; a bound server always has one.
const portOf = (server: Server<unknown>): number => server.port as number

describe('listenOnOpenPort', () => {
    const started: Server<unknown>[] = []
    const track = (server: Server<unknown>) => {
        started.push(server)
        return server
    }

    afterEach(() => {
        for (const server of started.splice(0)) {
            server.stop(true)
        }
    })

    test('binds the start port when it is free', () => {
        // Pick a free port to use as the scan start so the test is deterministic.
        const free = portOf(track(bindAt(0)))
        started[0].stop(true)
        const server = track(listenOnOpenPort(bindAt, free))
        expect(portOf(server)).toBe(free)
    })

    test('steps to the next port when the start port is already bound', () => {
        const occupiedPort = portOf(track(bindAt(0)))
        // The occupant holds its port; the real bind must skip upward, not crash on EADDRINUSE.
        const server = track(listenOnOpenPort(bindAt, occupiedPort))
        expect(portOf(server)).toBeGreaterThan(occupiedPort)
    })

    test('propagates failures that are not a port collision', () => {
        const boom = new Error('nope')
        expect(() =>
            listenOnOpenPort(() => {
                throw boom
            }, 3000),
        ).toThrow(boom)
    })
})
