// 21.15, 21.20, 21.21, 24.6, 24.7 — WHAT AN ANSWER'S `server-timing` CARRIES, over a served app
// (spawned, for `serve.test.ts`'s reason). An app rung takes 50 ms on every request, and a guarded
// handler's own rung takes 100 ms around a 100 ms body, so each duration names whose time it is.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { trace } from '#server/trace.ts'
import { serveApp } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

const APP = `import { middleware } from 'abide/server'

middleware(async (next) => {
    await Bun.sleep(50)
    return next()
})
`

const HANDLERS = `import { reactive } from 'abide'
import { GET, trace } from 'abide/server'

export const held = GET(
    reactive(
        async (args: { n: number }) => {
            await Bun.sleep(50)
            return { n: args.n }
        },
        { global: true, ttl: 60_000 },
    ),
)

export const guarded = GET(
    async () => {
        await Bun.sleep(100)
        return { n: 1 }
    },
    {
        middleware: [
            async (next) => {
                await Bun.sleep(100)
                return next()
            },
        ],
    },
)

export const spanned = GET(() =>
    trace.span(
        'db',
        async () => {
            await Bun.sleep(50)
            return { n: 1 }
        },
        { timing: true },
    ),
)
`

let base = ''
let stop = (): void => {}
const RPC = '/__abide/rpc/timed'

beforeAll(async () => {
    ;({ base, stop } = await serveApp({
        'ui/pages/page.abide': '<main>home</main>',
        'server/app.ts': APP,
        'server/rpc/timed.ts': HANDLERS,
    }))
}, 30_000)

afterAll(() => {
    stop()
    removeTemporaryModules()
})

// Each metric the header carries, by name, and its duration.
async function timings(address: string): Promise<Map<string, number>> {
    const answer = await Bun.fetch(`${base}${address}`)
    await answer.text()
    const metrics = new Map<string, number>()
    for (const entry of (answer.headers.get('server-timing') ?? '').split(
        ', ',
    )) {
        const [name, duration] = entry.split(';dur=')
        if (name !== undefined && duration !== undefined)
            metrics.set(name, Number(duration))
    }
    return metrics
}

// 21.15 — KEYED, so the first call for these args is the one that runs: an unkeyed `global` value
// starts its load when its module does. THE REVERT: drop `cached` from the run's choice; the second
// answer reads `Direct` with a settled await's duration, as though the handler had run and been fast.
test('a global production already held answers as Cached — 21.15', async () => {
    const first = await timings(`${RPC}/held?n=1`)
    expect(first.get('Direct')).toBeGreaterThanOrEqual(45)
    const second = await timings(`${RPC}/held?n=1`)
    expect([...second.keys()]).toEqual(['Cached', 'Middleware'])
    expect(second.get('Cached')).toBeLessThan(45)
})

// 21.20, 21.21 — THE REVERT: drop the `handled` split in `answerRpc`; `Direct` reads the rung's
// 100 ms and the body's together, and `Middleware` only the app rung's 50. NO CEILING ON A
// DURATION: a loaded machine runs every sleep long, so the split is read as a RELATION — the rungs'
// two sleeps against the body's one, about 150 to 100 as it stands and 50 to 200 reverted — and a
// slow run stretches the rungs' two sleeps as it does the body's one.
test("a handler's rungs are Middleware, and Direct is its body alone — 21.20, 21.21", async () => {
    const metrics = await timings(`${RPC}/guarded`)
    const direct = metrics.get('Direct') ?? 0
    const rungs = metrics.get('Middleware') ?? 0
    expect(direct).toBeGreaterThanOrEqual(95)
    // The app's 50 and the handler's 100.
    expect(rungs).toBeGreaterThanOrEqual(145)
    expect(rungs).toBeGreaterThan(direct)
})

// 21.20 — a page's head goes out before its render, so the app's rungs are what it can carry.
test("a page carries the app's rungs as Middleware — 21.20", async () => {
    const metrics = await timings('/')
    expect(metrics.get('Middleware')).toBeGreaterThanOrEqual(45)
})

// 24.6 — THE REVERT: drop the push in `trace.span`'s `close`; the header carries no `db`.
test('a span opened with timing is carried under its name — 24.6', async () => {
    const metrics = await timings(`${RPC}/spanned`)
    expect(metrics.get('db')).toBeGreaterThanOrEqual(45)
    expect(metrics.has('Direct')).toBe(true)
})

test('a timing span whose name is not a token throws — 24.7', () => {
    let thrown: unknown
    try {
        trace.span('two words', () => 1, { timing: true })
    } catch (error) {
        thrown = error
    }
    expect((thrown as Error).message).toContain('RULEBOOK 24.7')
    // Without `timing` the name is a log line's, and anything goes.
    expect(trace.span('two words', () => 1)).toBe(1)
})
