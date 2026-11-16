// SECTION 48 — A PROBLEM REPORT, on the server: which lines a draft is handed and to whom, what is
// taken out of it, and that every `onReport` hears it. The browser's half is `reportDialog.test.ts`.

import { afterEach, beforeAll, expect, test } from 'bun:test'

import { GET, log, onReport, type Report, report, trace } from '#server'
import { serveLocally } from '#server/bridgeRelay.ts'

import { inMemoryApp } from './inMemoryApp.ts'

const WINDOW = 'abide-native-credential=window-secret'
const SECRET = 'sealing-secret-1234'
const saved = process.env.ABIDE_PRINCIPAL_SECRET
const unfile: (() => void)[] = []

beforeAll(async () => {
    process.env.ABIDE_PRINCIPAL_SECRET = SECRET
    await serveLocally('window-secret')
})

afterEach(() => {
    for (const stop of unfile.splice(0)) stop()
})

process.on('exit', () => {
    if (saved === undefined) delete process.env.ABIDE_PRINCIPAL_SECRET
    else process.env.ABIDE_PRINCIPAL_SECRET = saved
})

/** Every report the app's `onReport` is handed while the test runs. */
function received(): Report[] {
    const reports: Report[] = []
    unfile.push(onReport((sent) => void reports.push(sent)))
    return reports
}

const sync = {
    'probe/sync.handler.ts': {
        default: GET(() => {
            log(`contact loaded with key ${SECRET}`)
            log.error('billing refused the key')
            return trace()
        }),
    },
}

async function failedSync(
    app: Awaited<ReturnType<typeof inMemoryApp>>,
): Promise<string> {
    return (
        await app.fetch(new Request('http://app.test/probe/sync'))
    ).json() as Promise<string>
}

// THE REVERT: drop `fromNativeWindow()` from `linesHandler` — the stranger reads both lines too.
test('the server hands its lines for a trace to the native app’s window alone — 48.4, 48.5', async () => {
    await using app = await inMemoryApp(sync)
    const traced = await failedSync(app)
    const lines = async (cookie: string): Promise<{ message: string }[]> =>
        (
            await app.fetch(
                new Request(
                    `http://app.test/__abide/report/lines?traces=${traced}`,
                    {
                        headers: { cookie },
                    },
                ),
            )
        ).json()
    expect((await lines(WINDOW)).map((line) => line.message)).toEqual([
        'contact loaded with key [redacted ABIDE_PRINCIPAL_SECRET]',
        'billing refused the key',
    ])
    expect(await lines('abide-native-credential=guessed')).toEqual([])
    expect(await lines('')).toEqual([])
})

// THE REVERT: drop `redactedLine` from `deliver` — the page's line reaches `onReport` holding the secret.
test('a sent report reaches every onReport with its secrets taken out, and the window’s gains the server’s lines — 48.4, 48.6, 48.10, 48.11', async () => {
    const reports = received()
    const also = received()
    await using app = await inMemoryApp(sync)
    const traced = await failedSync(app)
    const send = (cookie: string) =>
        app.fetch(
            new Request('http://app.test/__abide/report', {
                method: 'POST',
                headers: {
                    cookie,
                    'content-type': 'application/json',
                    'user-agent': 'abide-native/1.4.0',
                },
                body: JSON.stringify({
                    summary: 'Sync fails',
                    description: `I pasted ${SECRET} into the form`,
                    route: '/ops',
                    traces: [traced],
                    lines: [
                        {
                            time: '2026-01-01T00:00:00.000Z',
                            level: 'warning',
                            namespace: 'app',
                            message: `clicked sync after pasting ${SECRET}`,
                            trace: traced,
                        },
                    ],
                }),
            }),
        )
    expect((await send(WINDOW)).status).toBe(200)
    expect((await send('')).status).toBe(200)
    expect(also).toHaveLength(2)
    const [window, stranger] = reports as [Report, Report]
    expect(window.description).toBe(
        'I pasted [redacted ABIDE_PRINCIPAL_SECRET] into the form',
    )
    expect(window.platform).toBe('abide-native/1.4.0')
    expect(window.lines.map((line) => line.message)).toEqual([
        'clicked sync after pasting [redacted ABIDE_PRINCIPAL_SECRET]',
        'contact loaded with key [redacted ABIDE_PRINCIPAL_SECRET]',
        'billing refused the key',
    ])
    // A page's line claims no trace of its own.
    expect(window.lines[0]?.trace).toBe('')
    expect(stranger.lines.map((line) => line.message)).toEqual([
        'clicked sync after pasting [redacted ABIDE_PRINCIPAL_SECRET]',
    ])
    expect(window.markdown).toContain('## Sync fails')
    expect(window.markdown).not.toContain(SECRET)
})

test('a report with no onReport filed is refused, and one an onReport threw on is refused after every other ran — 48.6, 48.8', async () => {
    await using app = await inMemoryApp(sync)
    const send = () =>
        app.fetch(
            new Request('http://app.test/__abide/report', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    summary: 's',
                    description: '',
                    route: '/',
                    traces: [],
                    lines: [],
                }),
            }),
        )
    expect((await send()).status).toBe(501)
    unfile.push(
        onReport(() => {
            throw new Error('the tracker is down')
        }),
    )
    const reports = received()
    expect((await send()).status).toBe(502)
    expect(reports).toHaveLength(1)
})

// THE REVERT: `REPORTING.lines` left unfilled — a draft made on a server holds nothing.
test('a draft made on a server holds its lines and sends in process — 48.3, 48.6', async () => {
    const reports = received()
    await using app = await inMemoryApp(sync)
    const traced = await failedSync(app)
    const draft = await app.run(() => report({ trace: traced }))
    expect((await draft.lines).map((line) => line.message)).toEqual([
        'contact loaded with key [redacted ABIDE_PRINCIPAL_SECRET]',
        'billing refused the key',
    ])
    draft.summary.set('Sync fails')
    expect(draft.markdown()).toContain(`- traces: ${traced}`)
    await draft.send()
    expect(reports[0]?.markdown).toBe(draft.markdown())
})

// 36.5 — A ROTATED SECRET IS A LIST, and each of its secrets is taken out on its own. THE REVERT:
// redact `ABIDE_PRINCIPAL_SECRET` as one value — a line holding just one of the two keeps it.
test('each secret of a rotated ABIDE_PRINCIPAL_SECRET is taken out of a draft — 48.10, 36.5', async () => {
    process.env.ABIDE_PRINCIPAL_SECRET = `rotated-in-5678,${SECRET}`
    try {
        await using app = await inMemoryApp(sync)
        const traced = await failedSync(app)
        const draft = await app.run(() => report({ trace: traced }))
        expect((await draft.lines)[0]?.message).toBe(
            'contact loaded with key [redacted ABIDE_PRINCIPAL_SECRET]',
        )
    } finally {
        process.env.ABIDE_PRINCIPAL_SECRET = SECRET
    }
})
