// 38.34 — A TREE THE BUILD REFUSES is a finding for `abide lsp`, not a checker crash: the checker it
// opened answers every check after it, so a hover still answers. THE REVERT: let
// `routesDeclaration` call `appFiles(root)` with no refusal sink; three checks open three checkers.

import { afterAll, expect, spyOn, test } from 'bun:test'
import { serveLanguage } from '#compiler/serveLanguage.ts'
import { TypeSession } from '#compiler/TypeSession.ts'
import { appFixture } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

const PAGE = `<script>
const label: string = 5
</script>

<p>{label}</p>`

afterAll(() => {
    removeTemporaryModules()
})

test('a refused tree neither reopens the checker nor silences the page — 38.34, 23.18', async () => {
    const app = appFixture({
        'page.abide': PAGE,
        'media/server/page.abide': '<p>stray</p>',
    })
    const opened = spyOn(TypeSession, 'open')
    const received: {
        method?: string
        id?: number
        params?: unknown
        result?: unknown
    }[] = []
    let pending = ''
    const decoder = new TextDecoder()
    let feed!: ReadableStreamDefaultController<Uint8Array>
    const input = new ReadableStream<Uint8Array>({
        start: (controller) => {
            feed = controller
        },
    })
    const send = (message: object): void => {
        const body = new TextEncoder().encode(
            JSON.stringify({ jsonrpc: '2.0', ...message }),
        )
        feed.enqueue(
            new TextEncoder().encode(`Content-Length: ${body.length}\r\n\r\n`),
        )
        feed.enqueue(body)
    }
    const served = serveLanguage(app, input, (bytes) => {
        pending += decoder.decode(bytes)
        for (;;) {
            const end = pending.indexOf('\r\n\r\n')
            if (end === -1) break
            const length = Number(/Content-Length: (\d+)/.exec(pending)?.[1])
            if (pending.length < end + 4 + length) break
            received.push(JSON.parse(pending.slice(end + 4, end + 4 + length)))
            pending = pending.slice(end + 4 + length)
        }
    })
    const next = async (
        matches: (message: (typeof received)[number]) => boolean,
    ): Promise<(typeof received)[number]> => {
        for (let turn = 0; turn < 600; turn += 1) {
            const at = received.findIndex(matches)
            if (at !== -1)
                return received.splice(at, 1)[0] as (typeof received)[number]
            await Bun.sleep(50)
        }
        throw new Error(`no such message in ${JSON.stringify(received)}`)
    }
    const uri = Bun.pathToFileURL(`${app}/page.abide`).href
    send({
        method: 'textDocument/didOpen',
        params: {
            textDocument: { uri, languageId: 'abide', version: 1, text: PAGE },
        },
    })
    const codes: unknown[] = []
    for (let version = 1; version <= 3; version += 1) {
        if (version > 1)
            send({
                method: 'textDocument/didChange',
                params: {
                    textDocument: { uri, version },
                    contentChanges: [{ text: PAGE }],
                },
            })
        const published = await next(
            (message) => message.method === 'textDocument/publishDiagnostics',
        )
        for (const diagnostic of (
            published.params as { diagnostics: { code?: unknown }[] }
        ).diagnostics)
            codes.push(diagnostic.code)
    }
    send({
        id: 1,
        method: 'textDocument/hover',
        params: { textDocument: { uri }, position: { line: 4, character: 5 } },
    })
    const hover = await next((message) => message.id === 1)
    send({ id: 2, method: 'shutdown' })
    await next((message) => message.id === 2)
    send({ method: 'exit' })
    feed.close()
    await served
    expect(opened.mock.calls.length).toBe(1)
    expect(codes).toEqual([2322, 2322, 2322])
    expect(JSON.stringify(hover.result)).toContain('label')
    opened.mockRestore()
}, 60_000)
