// The `logs` subcommand: flag parsing, the health preflight, SSE rendering and the exit codes.

import { afterEach, expect, test } from 'bun:test'
import { logFeed } from '../../shared/internal/logFeed.ts'
import { createTestApp, type TestApp } from '../../test/createTestApp.ts'
import { CLI_EXIT_CODES } from './CLI_EXIT_CODES.ts'
import { logsCommand } from './logsCommand.ts'

afterEach(() => {
    logFeed.disable()
    delete Bun.env.ABIDE_LOGS
    delete Bun.env.ABIDE_LOG_FORMAT
})

interface Captured {
    code: number
    out: string
    err: string
}

async function run(origin: string, argv: string[]): Promise<Captured> {
    let out = ''
    let err = ''
    const code = await logsCommand({
        origin,
        argv,
        write: (text) => {
            out += text
        },
        writeError: (text) => {
            err += text
        },
    })
    return { code, out, err }
}

async function bootWithFeed(): Promise<TestApp> {
    Bun.env.ABIDE_LOGS = '1'
    return await createTestApp({ routes: {} })
}

test('an unknown flag is a usage error, and nothing is sent', async () => {
    // The origin is never dialled, so a bogus one proves parsing happens first.
    const result = await run('http://127.0.0.1:1', ['--nope', 'x'])
    expect(result.code).toBe(CLI_EXIT_CODES.usage)
    expect(result.err).toContain('unknown flag --nope')
})

test('--level is validated against the level names', async () => {
    const result = await run('http://127.0.0.1:1', ['--level', 'loud'])
    expect(result.code).toBe(CLI_EXIT_CODES.usage)
    expect(result.err).toContain('--level must be one of')
})

test('--tail must be a number', async () => {
    const result = await run('http://127.0.0.1:1', ['--tail', 'lots'])
    expect(result.code).toBe(CLI_EXIT_CODES.usage)
    expect(result.err).toContain('--tail needs a number')
})

test('an unreachable target is reported as such rather than hanging', async () => {
    // Port 1 refuses immediately.
    const result = await run('http://127.0.0.1:1', ['--no-follow'])
    expect(result.code).toBe(CLI_EXIT_CODES.failed)
    expect(JSON.parse(result.err).error).toBe('unreachable')
})

test('a host that is not an abide server is named, not tailed', async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response('hello from nginx') })
    try {
        const result = await run(server.url.origin, ['--no-follow'])
        expect(result.code).toBe(CLI_EXIT_CODES.failed)
        expect(JSON.parse(result.err).error).toBe('not-an-abide-server')
        // The preflight is the whole point: without it this would have been a silent empty tail.
        expect(result.out).toBe('')
    } finally {
        server.stop(true)
    }
})

test('a deployment with the feed disabled reports the 404 body and exit 5', async () => {
    delete Bun.env.ABIDE_LOGS
    const app = await createTestApp({ routes: {} })
    try {
        const result = await run(app.origin, ['--no-follow'])
        expect(result.code).toBe(CLI_EXIT_CODES.notFound)
        expect(result.err).toContain('ABIDE_LOGS')
    } finally {
        await app.stop()
    }
})

test('records render through the same formatter the server uses for stdout', async () => {
    Bun.env.ABIDE_LOG_FORMAT = 'tsv'
    const app = await bootWithFeed()
    try {
        logFeed.publish('log', 'myapp', 'hello from the deployment', undefined, new Date())
        const result = await run(app.origin, ['--no-follow', '--tail', '10'])
        expect(result.code).toBe(CLI_EXIT_CODES.ok)
        expect(result.out).toContain('[myapp]')
        expect(result.out).toContain('hello from the deployment')
        // tsv is tab-framed, so a collector can split it.
        expect(result.out.split('\n')[0]?.split('\t')[0]).toBe('log')
    } finally {
        await app.stop()
    }
})

test('warn and error go to stderr, everything else to stdout', async () => {
    Bun.env.ABIDE_LOG_FORMAT = 'tsv'
    const app = await bootWithFeed()
    try {
        logFeed.publish('log', 'myapp', 'ordinary', undefined, new Date())
        logFeed.publish('warn', 'myapp', 'a warning', undefined, new Date())
        logFeed.publish('error', 'myapp', 'a failure', undefined, new Date())
        const result = await run(app.origin, ['--no-follow', '--tail', '10'])
        expect(result.out).toContain('ordinary')
        expect(result.out).not.toContain('a warning')
        expect(result.err).toContain('a warning')
        expect(result.err).toContain('a failure')
    } finally {
        await app.stop()
    }
})

test('--level and --debug are applied server-side, not printed then discarded', async () => {
    Bun.env.ABIDE_LOG_FORMAT = 'tsv'
    const app = await bootWithFeed()
    try {
        logFeed.publish('info', 'abide:rpc', 'framework info', undefined, new Date())
        logFeed.publish('warn', 'abide:rpc', 'framework warning', undefined, new Date())
        logFeed.publish('warn', 'myapp', 'app warning', undefined, new Date())
        const result = await run(app.origin, [
            '--no-follow',
            '--tail',
            '50',
            '--level',
            'warn',
            '--debug',
            'abide:*',
        ])
        expect(result.err).toContain('framework warning')
        expect(result.err).not.toContain('app warning')
        expect(result.out).not.toContain('framework info')
    } finally {
        await app.stop()
    }
})

test('--flag=value is accepted alongside --flag value', async () => {
    Bun.env.ABIDE_LOG_FORMAT = 'tsv'
    const app = await bootWithFeed()
    try {
        logFeed.publish('log', 'a', 'first', undefined, new Date())
        logFeed.publish('log', 'b', 'second', undefined, new Date())
        const result = await run(app.origin, ['--no-follow', '--tail=1'])
        expect(result.out).toContain('second')
        expect(result.out).not.toContain('first')
    } finally {
        await app.stop()
    }
})

test('an abort ends the tail cleanly rather than as a failure', async () => {
    const app = await bootWithFeed()
    try {
        const feed = new AbortController()
        let out = ''
        const running = logsCommand({
            origin: app.origin,
            argv: ['--tail', '0'],
            write: (text) => {
                out += text
            },
            writeError: () => {},
            signal: feed.signal,
        })
        await Bun.sleep(100)
        logFeed.publish('log', 'myapp', 'while watching', undefined, new Date())
        await Bun.sleep(100)
        feed.abort()
        // A detach is how a tail normally ENDS, so it must not report failure.
        expect(await running).toBe(CLI_EXIT_CODES.ok)
        expect(out).toContain('while watching')
    } finally {
        await app.stop()
    }
})
