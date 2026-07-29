// The gating contract — which lines reach the terminal and which stay quiet.
//
// `log` had no tests. That was survivable while framework code wrote to `console` directly, and
// stopped being so once it didn't: `installShutdownHandlers` now reports a stalled or throwing
// `onStop` through `log.channel('abide:cli').error`, and its comment argues that is SAFE precisely
// because `error` bypasses channel gating. That argument is load-bearing — if the bypass ever went
// away, a teardown failure would vanish on a silent channel and the process would just die — so it
// is asserted here rather than trusted.

import { afterEach, describe, expect, test } from 'bun:test'
import { log } from './log.ts'

// Capture stdout/stderr rather than `console`: on the server `log` writes bytes directly, so spying
// on console would assert nothing about the path that actually runs.
function captured(run: () => void): { out: string; err: string } {
    const realOut = process.stdout.write
    const realErr = process.stderr.write
    const out: string[] = []
    const err: string[] = []
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
        out.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk))
        return true
    }) as typeof process.stdout.write
    process.stderr.write = ((chunk: string | Uint8Array): boolean => {
        err.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk))
        return true
    }) as typeof process.stderr.write
    try {
        run()
    } finally {
        process.stdout.write = realOut
        process.stderr.write = realErr
    }
    return { out: out.join(''), err: err.join('') }
}

const previousDebug = Bun.env.DEBUG
afterEach(() => {
    if (previousDebug === undefined) delete Bun.env.DEBUG
    else Bun.env.DEBUG = previousDebug
})

describe('channel gating', () => {
    test('a named channel is quiet with DEBUG unset', () => {
        delete Bun.env.DEBUG
        const { out, err } = captured(() => log.channel('abide:probe').info('routine detail'))
        expect(out + err).not.toContain('routine detail')
    })

    test('DEBUG names it, and the line carries the channel label', () => {
        Bun.env.DEBUG = 'abide:probe'
        const { out } = captured(() => log.channel('abide:probe').info('routine detail'))
        expect(out).toContain('routine detail')
        expect(out).toContain('[abide:probe]')
    })

    test('a DEBUG prefix wildcard admits the whole namespace', () => {
        Bun.env.DEBUG = 'abide:*'
        const { out } = captured(() => log.channel('abide:probe').info('routine detail'))
        expect(out).toContain('routine detail')
    })

    test('DEBUG naming a DIFFERENT channel does not admit this one', () => {
        Bun.env.DEBUG = 'abide:other'
        const { out, err } = captured(() => log.channel('abide:probe').info('routine detail'))
        expect(out + err).not.toContain('routine detail')
    })

    // The load-bearing one. `installShutdownHandlers` reports a stalled/throwing onStop on a channel
    // that is silent by default, and is only correct because of this.
    test('error ALWAYS emits, even on a gated channel', () => {
        delete Bun.env.DEBUG
        const { out, err } = captured(() =>
            log.channel('abide:probe').error('onStop teardown timed out'),
        )
        expect(err).toContain('onStop teardown timed out')
        expect(out).toBe('')
    })

    test('warn and trace are gated like info — error is the only exception', () => {
        delete Bun.env.DEBUG
        const { out, err } = captured(() => {
            log.channel('abide:probe').warn('gated warn')
            log.channel('abide:probe').trace('gated trace')
        })
        expect(out + err).not.toContain('gated warn')
        expect(out + err).not.toContain('gated trace')
    })

    test('the un-channeled logger is the app’s own stream and is never gated', () => {
        delete Bun.env.DEBUG
        const { out } = captured(() => log.info('the app said something'))
        expect(out).toContain('the app said something')
    })
})

describe('streams', () => {
    // Anything a shell would pipe belongs on stdout; anything it would surface as a problem on
    // stderr. A CLI that mixes these breaks `app > out.json`.
    test('info and trace go to stdout, warn and error to stderr', () => {
        Bun.env.DEBUG = 'abide:probe'
        const channel = log.channel('abide:probe')
        expect(captured(() => channel.info('i')).out).toContain('i')
        expect(captured(() => channel.trace('t')).out).toContain('t')
        expect(captured(() => channel.warn('w')).err).toContain('w')
        expect(captured(() => channel.error('e')).err).toContain('e')
    })
})

// ---------------------------------------------------------------------------
// The other side
// ---------------------------------------------------------------------------

// `log` is isomorphic and BOTH halves are live in production: `ui/internal/runtime.ts` warns on
// `abide:hydrate` when hydration finds a mismatch and `ui/internal/streamScheduler.ts` errors on
// `abide:stream`, in the browser, out of the client bundle. Neither is reachable from the tests
// above — `src/test/happydom.ts` deletes `globalThis.window` so the test process reads as a server.
//
// So the browser half runs in its own process. See `__fixtures__/browserLogProbe.ts` for why a
// helper inside this file cannot work (a cache-busting re-import of `log.ts` still binds the CACHED
// `isBrowser`, takes the server path, and looks like it took the browser one).

interface ConsoleCall {
    level: string
    args: unknown[]
}

async function inBrowser(debug?: string): Promise<ConsoleCall[]> {
    const proc = Bun.spawn(['bun', `${import.meta.dir}/__fixtures__/browserLogProbe.ts`], {
        env: debug === undefined ? { ...Bun.env } : { ...Bun.env, PROBE_DEBUG: debug },
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const output = await new Response(proc.stdout).text()
    const marker = output.indexOf('@@')
    if (marker === -1) {
        throw new Error(
            `browser log probe produced no result: ${await new Response(proc.stderr).text()}`,
        )
    }
    return JSON.parse(output.slice(marker + 2)) as ConsoleCall[]
}

describe('the browser half', () => {
    test('a named channel goes to console, badged and tinted with its own colour', async () => {
        const calls = await inBrowser('abide:*')
        const hydrate = calls.find((call) => String(call.args[0]).includes('abide:hydrate'))
        expect(hydrate?.level).toBe('warn')
        // `%c` tints the badge, and the real args follow it unflattened so objects stay inspectable
        // in devtools rather than being stringified into the message.
        expect(hydrate?.args[0]).toBe('%c[abide:hydrate]%c')
        expect(String(hydrate?.args[1])).toStartWith('color:')
        expect(hydrate?.args).toContain('hydration mismatch')
    })

    test('gating is localStorage.debug in the browser, not DEBUG', async () => {
        const quiet = await inBrowser()
        expect(quiet.some((call) => call.args.includes('hydration mismatch'))).toBe(false)

        const named = await inBrowser('abide:hydrate')
        expect(named.some((call) => call.args.includes('hydration mismatch'))).toBe(true)
    })

    test('error still bypasses gating on the client', async () => {
        // How `streamScheduler` reports a failed stream. A silent channel must not swallow it —
        // the same rule as the server, asserted on the side that has a different sink.
        const calls = await inBrowser()
        const failed = calls.find((call) => call.args.includes('stream failed'))
        expect(failed?.level).toBe('error')
    })

    // The client has no environment, so it reads the app name off the global the client build bakes
    // into the loader entry. If that seed were missing this badge would read `[abide:cards]` while
    // the server's line for the same channel read `[probeapp:cards]`.
    test('a bare channel qualifies under the app name on the client too', async () => {
        const calls = await inBrowser()
        const bare = calls.find((call) => call.args.includes('bare channel'))
        expect(bare?.args[0]).toBe('%c[probeapp:cards]%c')
    })

    test('the un-channeled logger is never gated on the client either', async () => {
        const calls = await inBrowser()
        expect(calls.some((call) => call.args.includes('the app said something'))).toBe(true)
    })
})
