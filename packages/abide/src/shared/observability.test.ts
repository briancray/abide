// CO2 — observability: log (channels + format), trace (W3C traceparent), health, online, reachable.

import { afterEach, describe, expect, test } from 'bun:test'
import { GET } from '../server/GET.ts'
import { createTestApp } from '../test/createTestApp.ts'
import { health } from './health.ts'
import { outgoingTraceparent } from './internal/outgoingTraceparent.ts'
import { createReactiveScope, enterScope } from './internal/reactiveScope.ts'
import { traceAmbient } from './internal/traceAmbient.ts'
import { log } from './log.ts'
import { online } from './online.ts'
import { reachable } from './reachable.ts'
import { trace } from './trace.ts'

const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/

// The 256-colour SGR prefix a pretty line paints its channel label with. Built from a string because a
// raw ESC in a regex literal is a lint error (and invisible in a diff).
const CHANNEL_COLOR = new RegExp(`${String.fromCharCode(27)}\\[38;5;(\\d+)m(?=abide)`)

// Capture what log writes to stdout for the duration of `run`, restoring the real stream after.
function captureStdout(run: () => void): string[] {
    const writes: string[] = []
    const original = process.stdout.write.bind(process.stdout)
    ;(process.stdout as { write: (chunk: string) => boolean }).write = (chunk: string): boolean => {
        writes.push(String(chunk))
        return true
    }
    try {
        run()
    } finally {
        ;(process.stdout as { write: typeof original }).write = original
    }
    return writes
}

// Capture what log writes to stderr (warn/error) for the duration of `run`.
function captureStderr(run: () => void): string[] {
    const writes: string[] = []
    const original = process.stderr.write.bind(process.stderr)
    ;(process.stderr as { write: (chunk: string) => boolean }).write = (chunk: string): boolean => {
        writes.push(String(chunk))
        return true
    }
    try {
        run()
    } finally {
        ;(process.stderr as { write: typeof original }).write = original
    }
    return writes
}

afterEach(() => {
    delete Bun.env.DEBUG
    delete Bun.env.ABIDE_LOG_FORMAT
    delete Bun.env.NO_COLOR
    delete Bun.env.FORCE_COLOR
    delete Bun.env.ABIDE_APP_NAME
    delete (globalThis as { localStorage?: unknown }).localStorage
})

describe('log — channel gating by DEBUG', () => {
    test('a channel emits only when DEBUG names it (or *)', () => {
        const writes = captureStdout(() => {
            Bun.env.ABIDE_APP_NAME = 'myapp'
            delete Bun.env.DEBUG
            log.channel('cache')('hidden')

            Bun.env.DEBUG = 'myapp:cache,myapp:rpc'
            log.channel('cache')('shown')
            log.channel('other')('still hidden')

            Bun.env.DEBUG = '*'
            log.channel('anything')('wildcard')
        })
        expect(writes.length).toBe(2)
        expect(writes[0]).toContain('shown')
        expect(writes[0]).toContain('[myapp:cache]')
        expect(writes[1]).toContain('wildcard')
    })

    // The gate reads the QUALIFIED label, so an app namespaces its own channels the way abide does
    // and lights all of them at once — without any call site spelling the app name.
    test('a bare channel name is qualified with the app name, and DEBUG=<app>:* lights it', () => {
        const writes = captureStdout(() => {
            Bun.env.ABIDE_APP_NAME = 'myapp'
            Bun.env.DEBUG = 'myapp:*'
            log.channel('cards')('qualified')
        })
        expect(writes.length).toBe(1)
        expect(writes[0]).toContain('[myapp:cards]')
    })

    // The escape hatch, and what keeps `abide:*` intact inside an app called something else.
    test('a name that already carries a namespace is used verbatim', () => {
        const writes = captureStdout(() => {
            Bun.env.ABIDE_APP_NAME = 'myapp'
            Bun.env.DEBUG = 'abide:*'
            log.channel('abide:rpc')('framework')
        })
        expect(writes.length).toBe(1)
        expect(writes[0]).toContain('[abide:rpc]')
        expect(writes[0]).not.toContain('myapp')
    })

    test('base log levels always emit regardless of DEBUG', () => {
        const writes = captureStdout(() => {
            delete Bun.env.DEBUG
            log.info('always')
        })
        expect(writes.length).toBe(1)
        expect(writes[0]).toContain('always')
    })

    test('error bypasses gating on a named channel (failures always surface)', () => {
        const writes = captureStderr(() => {
            delete Bun.env.DEBUG
            log.channel('abide:rpc').error('boom')
            log.channel('abide:rpc').warn('quiet') // warn stays gated
        })
        expect(writes.length).toBe(1)
        expect(writes[0]).toContain('boom')
        expect(writes[0]).toContain('[abide:rpc]')
    })

    test('a channel emits when localStorage.debug names it (browser gate)', () => {
        const writes = captureStdout(() => {
            delete Bun.env.DEBUG
            ;(globalThis as { localStorage?: { getItem(k: string): string | null } }).localStorage =
                { getItem: (key) => (key === 'debug' ? 'abide:*' : null) }
            log.channel('abide:memo')('via localStorage')
        })
        expect(writes.length).toBe(1)
        expect(writes[0]).toContain('via localStorage')
        expect(writes[0]).toContain('[abide:memo]')
    })
})

describe('log — default channel is the app name', () => {
    test('the un-channeled logger is labeled "abide" by default', () => {
        const writes = captureStdout(() => {
            delete Bun.env.ABIDE_APP_NAME
            log.info('hello')
        })
        expect(writes[0]).toContain('[abide]')
    })

    test('ABIDE_APP_NAME sets the default channel label', () => {
        const writes = captureStdout(() => {
            Bun.env.ABIDE_APP_NAME = 'myapp'
            log.info('hello')
        })
        expect(writes[0]).toContain('[myapp]')
        expect(writes[0]).not.toContain('[abide]')
    })
})

describe('log — format toggles on ABIDE_LOG_FORMAT', () => {
    test('json format writes a parseable JSON line', () => {
        const writes = captureStdout(() => {
            Bun.env.ABIDE_LOG_FORMAT = 'json'
            log.info('hello')
        })
        const firstWrite = writes[0]
        if (firstWrite === undefined) throw new Error('expected a stdout write')
        const parsed = JSON.parse(firstWrite.trim())
        expect(parsed.level).toBe('info')
        expect(parsed.message).toBe('hello')
        expect(typeof parsed.time).toBe('string')
    })

    test('default format is tab-separated (not JSON)', () => {
        const writes = captureStdout(() => {
            delete Bun.env.ABIDE_LOG_FORMAT
            log.info('hello')
        })
        const firstWrite = writes[0]
        if (firstWrite === undefined) throw new Error('expected a stdout write')
        expect(firstWrite).toContain('\t')
        expect(() => JSON.parse(firstWrite.trim())).toThrow()
    })

    test('ABIDE_LOG_FORMAT names a MACHINE format — tsv wins over a forced colour', () => {
        const writes = captureStdout(() => {
            Bun.env.ABIDE_LOG_FORMAT = 'tsv'
            Bun.env.FORCE_COLOR = '1'
            log.info('hello')
        })
        const firstWrite = writes[0]
        if (firstWrite === undefined) throw new Error('expected a stdout write')
        expect(firstWrite).toContain('\t')
        expect(firstWrite).not.toContain('\x1b[')
    })

    test('FORCE_COLOR writes coloured columns, not tabs', () => {
        const writes = captureStdout(() => {
            Bun.env.FORCE_COLOR = '1'
            Bun.env.DEBUG = 'abide:*'
            log.channel('abide:rpc').info('hello')
        })
        const firstWrite = writes[0]
        if (firstWrite === undefined) throw new Error('expected a stdout write')
        expect(firstWrite).not.toContain('\t')
        expect(firstWrite).toContain('\x1b[') // colour
        expect(firstWrite).toContain('abide:rpc')
        expect(firstWrite).toContain('hello')
        // local wall-clock time, no date
        expect(firstWrite).toMatch(/\d\d:\d\d:\d\d\.\d\d\d/)
        expect(firstWrite).not.toContain('T')
    })

    test('a channel keeps ONE colour across lines, and two channels differ', () => {
        const writes = captureStdout(() => {
            Bun.env.FORCE_COLOR = '1'
            Bun.env.DEBUG = 'abide:*'
            log.channel('abide:rpc').info('one')
            log.channel('abide:rpc').info('two')
            log.channel('abide:ssr').info('three')
        })
        const colorOf = (line: string): string => {
            const match = line.match(CHANNEL_COLOR)
            if (match === null) throw new Error(`no channel colour in ${JSON.stringify(line)}`)
            return match[1] as string
        }
        expect(colorOf(writes[0] as string)).toBe(colorOf(writes[1] as string))
        expect(colorOf(writes[2] as string)).not.toBe(colorOf(writes[0] as string))
    })

    test('a multi-line message indents its continuation lines under the first', () => {
        const writes = captureStderr(() => {
            Bun.env.FORCE_COLOR = '1'
            log.error('boom\n  at somewhere')
        })
        const firstWrite = writes[0]
        if (firstWrite === undefined) throw new Error('expected a stderr write')
        const lines = firstWrite.trimEnd().split('\n')
        expect(lines.length).toBe(2)
        expect(lines[1]).toContain('    ')
        expect(lines[1]).toContain('at somewhere')
    })

    test('NO_COLOR falls back to the plain tab-separated line', () => {
        const writes = captureStdout(() => {
            Bun.env.NO_COLOR = '1'
            delete Bun.env.ABIDE_LOG_FORMAT
            log.info('hello')
        })
        const firstWrite = writes[0]
        if (firstWrite === undefined) throw new Error('expected a stdout write')
        expect(firstWrite).toContain('\t')
        expect(firstWrite).not.toContain('\x1b[')
    })
})

describe('trace — W3C traceparent within a request', () => {
    test('returns undefined outside a request scope', () => {
        expect(trace()).toBeUndefined()
    })

    test('is a valid traceparent and stable within one request', async () => {
        const traceRpc = GET(() => {
            const first = trace()
            const second = trace()
            return { first, stable: first === second }
        })
        const app = await createTestApp({ routes: { traceRpc } })
        try {
            const traceRpcCall = app.rpc.traceRpc
            if (traceRpcCall === undefined) throw new Error('expected traceRpc on the test app')
            const body = (await traceRpcCall()) as { first: string; stable: boolean }
            expect(body.first).toMatch(TRACEPARENT)
            expect(body.stable).toBe(true)
        } finally {
            await app.stop()
        }
    })

    test('propagates an incoming traceparent header', async () => {
        const traceRpc = GET(() => ({ value: trace() }))
        const app = await createTestApp({ routes: { traceRpc } })
        const incoming = `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`
        try {
            const response = await app.fetch('/__abide/rpc/traceRpc', {
                method: 'GET',
                headers: { traceparent: incoming },
            })
            const body = (await response.json()) as { value: string }
            expect(body.value).toBe(incoming)
            expect(response.headers.get('traceparent')).toBe(incoming)
            expect(response.headers.get('traceresponse')).toBe(incoming)
        } finally {
            await app.stop()
        }
    })

    test('a request with NO incoming traceparent still answers with a minted one', async () => {
        // The trace is a property of the request, not of whether a handler asked for it: this rpc
        // never calls trace(), and the response carries the pair anyway.
        const silentRpc = GET(() => ({ ok: true }))
        const app = await createTestApp({ routes: { silentRpc } })
        try {
            const response = await app.fetch('/__abide/rpc/silentRpc')
            const minted = response.headers.get('traceparent')
            expect(minted).toMatch(TRACEPARENT)
            expect(response.headers.get('traceresponse')).toBe(minted)
        } finally {
            await app.stop()
        }
    })

    test('a malformed incoming traceparent is replaced, not propagated', async () => {
        const traceRpc = GET(() => ({ value: trace() }))
        const app = await createTestApp({ routes: { traceRpc } })
        try {
            const response = await app.fetch('/__abide/rpc/traceRpc', {
                headers: { traceparent: 'not-a-traceparent' },
            })
            const body = (await response.json()) as { value: string }
            expect(body.value).toMatch(TRACEPARENT)
            expect(body.value).not.toBe('not-a-traceparent')
            expect(response.headers.get('traceresponse')).toBe(body.value)
        } finally {
            await app.stop()
        }
    })

    test('two requests get two different traces', async () => {
        const traceRpc = GET(() => ({ value: trace() }))
        const app = await createTestApp({ routes: { traceRpc } })
        try {
            const first = (await (await app.fetch('/__abide/rpc/traceRpc')).json()) as {
                value: string
            }
            const second = (await (await app.fetch('/__abide/rpc/traceRpc')).json()) as {
                value: string
            }
            expect(first.value).not.toBe(second.value)
        } finally {
            await app.stop()
        }
    })

    test('a content-addressed asset is NOT traced', async () => {
        // The one exemption: an immutable, identity-free, cross-user-shared byte response. A 404 under
        // the same prefix is still an asset request — the exemption is the route class, not the hit.
        const app = await createTestApp({ routes: {} })
        try {
            const response = await app.fetch('/__abide/chunk/missing-0000.js')
            expect(response.headers.get('traceparent')).toBeNull()
            expect(response.headers.get('traceresponse')).toBeNull()
        } finally {
            await app.stop()
        }
    })
})

describe('trace — the adopted (client) trace', () => {
    // A non-request scope is what the browser's tab singleton IS structurally (`requestScoped` is set
    // only by `runInScope`), so these exercise the client semantics without a DOM.
    test('a non-request scope never mints — it answers only what was adopted', () => {
        enterScope(createReactiveScope(), () => {
            expect(trace()).toBeUndefined()
            const fromServer = `00-${'c'.repeat(32)}-${'d'.repeat(16)}-01`
            traceAmbient.adopt(fromServer)
            expect(trace()).toBe(fromServer)
        })
    })

    test('a later navigation replaces the adopted trace', () => {
        enterScope(createReactiveScope(), () => {
            const first = `00-${'1'.repeat(32)}-${'2'.repeat(16)}-01`
            const second = `00-${'3'.repeat(32)}-${'4'.repeat(16)}-01`
            traceAmbient.adopt(first)
            traceAmbient.adopt(second)
            expect(trace()).toBe(second)
        })
    })

    test('a malformed or absent value is dropped, leaving the previous trace standing', () => {
        enterScope(createReactiveScope(), () => {
            const good = `00-${'e'.repeat(32)}-${'f'.repeat(16)}-01`
            traceAmbient.adopt(good)
            traceAmbient.adopt('nonsense')
            traceAmbient.adopt(null)
            traceAmbient.adopt(undefined)
            expect(trace()).toBe(good)
        })
    })
})

describe('trace — the outgoing (client → server) child span', () => {
    test('keeps the trace id and flags, mints a NEW span id (W3C: the caller names the span)', () => {
        enterScope(createReactiveScope(), () => {
            const page = `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`
            traceAmbient.adopt(page)
            const outgoing = outgoingTraceparent()
            if (outgoing === undefined) throw new Error('expected an outgoing traceparent')
            expect(outgoing).toMatch(TRACEPARENT)
            const [version, traceId, spanId, flags] = outgoing.split('-')
            expect(version).toBe('00')
            expect(traceId).toBe('a'.repeat(32)) // same trace — the call joins the page's
            expect(flags).toBe('01') // sampling decision carried, never re-decided mid-trace
            expect(spanId).not.toBe('b'.repeat(16)) // but its own span
        })
    })

    test('two calls in one trace get two different spans', () => {
        enterScope(createReactiveScope(), () => {
            traceAmbient.adopt(`00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`)
            expect(outgoingTraceparent()).not.toBe(outgoingTraceparent())
        })
    })

    test('undefined when there is no trace to be inside — no locally invented parent', () => {
        // The precondition has to be established explicitly now. `trace()`'s client half reads a
        // module-level holder (a TAB singleton — one adopted trace per tab, which is what makes
        // `{trace()}` re-render on a nav), so entering a fresh reactive scope no longer means "nothing
        // adopted"; the tests above in this block adopted one. Previously the trace lived ON the scope,
        // which also meant a component that mounted its own scope silently lost it.
        //
        // The assertion is unchanged, and it is the one that matters: with nothing adopted we return
        // undefined rather than MINTING a parent locally. A client-invented id would name a trace no
        // server span belongs to.
        traceAmbient.clear()
        enterScope(createReactiveScope(), () => {
            expect(outgoingTraceparent()).toBeUndefined()
        })
    })
})

describe('health / online / reachable', () => {
    test('health() reports reachable: true and the abide version (server baseline)', async () => {
        const doc = await health()
        expect(doc.reachable).toBe(true)
        expect(typeof doc.version).toBe('string')
    })

    test('online() is true on the server', () => {
        expect(online()).toBe(true)
    })

    test('reachable() is true for a live origin and false for a dead one', async () => {
        const app = await createTestApp({})
        try {
            expect(await reachable(app.origin)).toBe(true)
            expect(await reachable('http://127.0.0.1:1')).toBe(false)
        } finally {
            await app.stop()
        }
    })
})
