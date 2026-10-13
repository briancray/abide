// 38.11 — `abide lsp`, OVER STDIO, as an editor drives it: the handshake, a document opened with text
// that was never saved, a change that fixes it, and the shutdown. What it publishes is what `abide
// check` finds (38.3), on the line and character the editor shows — the editor's text, not the
// disk's.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { basename, dirname } from 'node:path' // bun exposes no path helpers of its own
import { appFixture } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

const BIN = new URL('../bin/abide.ts', import.meta.url).pathname

const SAVED = `<script>
import { reactive } from '@abide/abide'
import Card from './ui/components/Card.abide'

let count = reactive(0)
</script>

<p>{count.toFixed(1)}</p>
<Card title="x"/>`

// Never written to disk — only the editor holds it.
const EDITED = `<script>
import { reactive } from '@abide/abide'
import Card from './ui/components/Card.abide'

let count = reactive(0)
</script>

<p>{count.toUpperCase()}</p>
<Card title="x"/>`

const CARD = `<script>
import { props } from '@abide/abide'

const { title } = props<{ title: string }>()
</script>

<p>{title}</p>`

// Reads a name its neighbor does not export until the test saves it.
const LATER = `<script>
import { later } from '../ui/extra.ts'
</script>

<p>{later}</p>`

// 38.98 — at the member access, as the editor holds it while the author types the member.
const READING = `<script server>
import { config } from '@abide/abide/server'

const retries = config().
void retries
</script>`

// 38.39 — a row's bindings, named in the block's head.
const ROWS = `<script>
const paths = ['a', 'b']
</script>

{#for path, index of paths}<p>{path}{index}</p>{/for}`

let app = ''
let server: Bun.Subprocess<'pipe', 'pipe', 'pipe'> | undefined
const received: { method?: string; id?: number; params?: unknown }[] = []

function send(message: object): void {
    const body = JSON.stringify({ jsonrpc: '2.0', ...message })
    server?.stdin.write(
        `Content-Length: ${new TextEncoder().encode(body).length}\r\n\r\n${body}`,
    )
    server?.stdin.flush()
}

async function readAll(stdout: ReadableStream<Uint8Array>): Promise<void> {
    let pending = ''
    for await (const chunk of stdout) {
        pending += new TextDecoder().decode(chunk)
        for (;;) {
            const end = pending.indexOf('\r\n\r\n')
            if (end === -1) break
            const length = Number(/Content-Length: (\d+)/.exec(pending)?.[1])
            if (pending.length < end + 4 + length) break
            received.push(JSON.parse(pending.slice(end + 4, end + 4 + length)))
            pending = pending.slice(end + 4 + length)
        }
    }
}

async function next(
    matches: (message: (typeof received)[number]) => boolean,
): Promise<(typeof received)[number]> {
    for (let turn = 0; turn < 600; turn += 1) {
        const at = received.findIndex(matches)
        if (at !== -1)
            return received.splice(at, 1)[0] as (typeof received)[number]
        await Bun.sleep(50)
    }
    throw new Error(`no such message in ${JSON.stringify(received)}`)
}

beforeAll(() => {
    app = appFixture({
        'page.abide': SAVED,
        'ui/components/Card.abide': CARD,
        'ui/extra.ts': 'export const extra = 1\n',
        'more/page.abide': LATER,
        'reading/page.abide': READING,
        'rows/page.abide': ROWS,
        'settings/page.abide': `<script server>
import { onConfig } from '@abide/abide/server'

onConfig(() => ({ RETRIES: 3 }))
</script>`,
    })
    // AS AN EDITOR STARTS IT: no `--root`, and from a directory that is not the app — a monorepo's
    // root, here the filesystem's. The document says which app it is in.
    server = Bun.spawn(['bun', BIN, 'lsp'], {
        cwd: '/',
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
    })
    void readAll(server.stdout)
})

afterAll(() => {
    server?.kill()
    removeTemporaryModules()
})

// THE REVERT: publish the diagnostics of the saved file (`Bun.file(path).text()`) in place of the
// document's; the edited text's error is never reported, and the first publish is empty. Or check
// every document against the directory the server started in; nothing is published at all.
test('an open document is checked as the editor holds it, and cleared when fixed — 38.11', async () => {
    send({ id: 1, method: 'initialize', params: { capabilities: {} } })
    const initialized = await next((message) => message.id === 1)
    expect(initialized).toMatchObject({
        result: { capabilities: { textDocumentSync: 1 } },
    })
    const uri = Bun.pathToFileURL(`${app}/page.abide`).href
    send({
        method: 'textDocument/didOpen',
        params: {
            textDocument: {
                uri,
                languageId: 'abide',
                version: 1,
                text: EDITED,
            },
        },
    })
    const published = await next(
        (message) => message.method === 'textDocument/publishDiagnostics',
    )
    const line = EDITED.split('\n').findIndex((text) =>
        text.includes('toUpperCase'),
    )
    expect(published.params).toMatchObject({
        uri,
        diagnostics: [
            {
                range: {
                    start: { line, character: 10 },
                    end: { line, character: 21 },
                },
                severity: 1,
                code: 2339,
            },
        ],
    })

    send({
        method: 'textDocument/didChange',
        params: {
            textDocument: { uri, version: 2 },
            contentChanges: [{ text: SAVED }],
        },
    })
    const cleared = await next(
        (message) => message.method === 'textDocument/publishDiagnostics',
    )
    expect(cleared.params).toEqual({ uri, diagnostics: [] })
}, 60_000)

// THE REVERT: answer `textDocument/hover` from the checked module alone, as a build lowers it; the
// name read by name is a rewrite there and nothing is found at `count`. Or map the position through
// the projection only; `toFixed` is then asked of the `Reactive`, which has no such member.
test('a hover and a jump answer about the document as the editor holds it — 38.39', async () => {
    const uri = Bun.pathToFileURL(`${app}/page.abide`).href
    const line = SAVED.split('\n').findIndex((text) => text.includes('toFixed'))
    const character = (name: string): number =>
        (SAVED.split('\n')[line] as string).indexOf(name) + 1

    send({
        id: 3,
        method: 'textDocument/hover',
        params: {
            textDocument: { uri },
            position: { line, character: character('count') },
        },
    })
    expect(await next((message) => message.id === 3)).toMatchObject({
        result: {
            contents: {
                kind: 'markdown',
                value: '```ts\nlet count: Reactive<number, number, never>\n```',
            },
        },
    })

    send({
        id: 4,
        method: 'textDocument/definition',
        params: {
            textDocument: { uri },
            position: { line, character: character('count') },
        },
    })
    expect(await next((message) => message.id === 4)).toMatchObject({
        result: [
            {
                uri,
                range: {
                    start: { line: 4, character: 4 },
                    end: { line: 4, character: 9 },
                },
            },
        ],
    })

    send({
        id: 5,
        method: 'textDocument/hover',
        params: {
            textDocument: { uri },
            position: { line, character: character('toFixed') },
        },
    })
    const member = (await next((message) => message.id === 5)) as {
        result: { contents: { value: string } }
    }
    expect(member.result.contents.value).toStartWith('```ts\n(method) toFixed(')

    send({
        id: 6,
        method: 'textDocument/definition',
        params: {
            textDocument: { uri },
            position: { line, character: character('toFixed') },
        },
    })
    const declared = (await next((message) => message.id === 6)) as {
        result: { uri: string }[]
    }
    expect(declared.result[0]?.uri).toEndWith('.d.ts')

    // A COMPONENT TAG IS THE NAME IT INVOKES, and the component is its file. THE REVERT: leave the
    // tag out of the projection (`projectShadow`); nothing is found on it, and the hover is null.
    const tag = SAVED.split('\n').findIndex((text) => text.includes('<Card'))
    send({
        id: 7,
        method: 'textDocument/hover',
        params: {
            textDocument: { uri },
            position: { line: tag, character: 2 },
        },
    })
    expect(await next((message) => message.id === 7)).toMatchObject({
        result: {
            contents: {
                value: '```ts\n(component) Card(props: { title: string; })\n```',
            },
        },
    })
    send({
        id: 8,
        method: 'textDocument/definition',
        params: {
            textDocument: { uri },
            position: { line: tag, character: 2 },
        },
    })
    expect(await next((message) => message.id === 8)).toMatchObject({
        result: [
            {
                uri: Bun.pathToFileURL(`${app}/ui/components/Card.abide`).href,
                range: { start: { line: 0, character: 0 } },
            },
        ],
    })

    // 38.40 — A TAG IS HELD TO THE PROPS ITS COMPONENT DECLARES, with the component not open: the
    // page's imports are lowered beside it. THE REVERT: check the page alone (`checkSource` with
    // no imports); `Card`'s checked module is the stand-in that takes anything, and nothing is
    // published but the empty list.
    send({
        method: 'textDocument/didChange',
        params: {
            textDocument: { uri, version: 3 },
            contentChanges: [
                { text: SAVED.replace('title="x"', 'title={count}') },
            ],
        },
    })
    expect(
        (
            await next(
                (message) =>
                    message.method === 'textDocument/publishDiagnostics',
            )
        ).params,
    ).toMatchObject({
        uri,
        diagnostics: [
            {
                range: { start: { line: tag, character: 13 } },
                code: 2322,
                message: "Type 'number' is not assignable to type 'string'.",
            },
        ],
    })
    send({
        method: 'textDocument/didChange',
        params: {
            textDocument: { uri, version: 4 },
            contentChanges: [{ text: SAVED }],
        },
    })
    expect(
        (
            await next(
                (message) =>
                    message.method === 'textDocument/publishDiagnostics',
            )
        ).params,
    ).toEqual({ uri, diagnostics: [] })

    // AND WITH THE COMPONENT OPEN, its checked module is lowered rather than stood in for, and the
    // stand-in is scaffolding after the author's last line. THE REVERT: map a span of it back as a
    // copied one (`ShadowMap.spanToSource` skipping its `copiedFrom`); the jump lands at the end of
    // `Card`'s markup.
    const card = Bun.pathToFileURL(`${app}/ui/components/Card.abide`).href
    send({
        method: 'textDocument/didOpen',
        params: {
            textDocument: {
                uri: card,
                languageId: 'abide',
                version: 1,
                text: CARD,
            },
        },
    })
    await next(
        (message) =>
            message.method === 'textDocument/publishDiagnostics' &&
            (message.params as { uri: string }).uri === card,
    )
    send({
        id: 9,
        method: 'textDocument/definition',
        params: {
            textDocument: { uri },
            position: { line: tag, character: 2 },
        },
    })
    expect(await next((message) => message.id === 9)).toMatchObject({
        result: [{ uri: card, range: { start: { line: 0, character: 0 } } }],
    })
}, 60_000)

// 38.11 — THE DISK MOVES UNDER A KEPT CHECKER: a page open in the editor imports a name its `.ts`
// neighbor does not export yet, and the neighbor is saved with it. The page itself is not touched,
// so nothing but the watcher can say the finding is gone. THE REVERT: drop the `session.edited(…)`
// call in `AppChecker.current`; the page reports "has no exported member" for as long as it is open.
test('a save to a plain .ts beside an open page reaches its findings — 38.11', async () => {
    const uri = Bun.pathToFileURL(`${app}/more/page.abide`).href
    send({
        method: 'textDocument/didOpen',
        params: {
            textDocument: {
                uri,
                languageId: 'abide',
                version: 1,
                text: LATER,
            },
        },
    })
    const before = await next(
        (message) =>
            message.method === 'textDocument/publishDiagnostics' &&
            (message.params as { uri: string }).uri === uri,
    )
    expect(
        (before.params as { diagnostics: { code: number }[] }).diagnostics.map(
            (diagnostic) => diagnostic.code,
        ),
    ).toEqual([2305])

    await Bun.write(
        `${app}/ui/extra.ts`,
        'export const extra = 1\nexport const later = 2\n',
    )
    const after = await next(
        (message) =>
            message.method === 'textDocument/publishDiagnostics' &&
            (message.params as { uri: string }).uri === uri,
    )
    expect(after.params).toMatchObject({ uri, diagnostics: [] })
})

// A DOCUMENT WITH NO FILE BEHIND IT has no path to find an app from, and its check threw out of the
// queue every later check waits behind. THE REVERT: accept any `.abide` in `didOpen`; the page's
// change is never published.
test('an untitled document leaves every other one checked — 38.11', async () => {
    send({
        method: 'textDocument/didOpen',
        params: {
            textDocument: {
                uri: 'untitled:Scratch.abide',
                languageId: 'abide',
                version: 1,
                text: SAVED,
            },
        },
    })
    const uri = Bun.pathToFileURL(`${app}/page.abide`).href
    send({
        method: 'textDocument/didChange',
        params: {
            textDocument: { uri, version: 99 },
            contentChanges: [{ text: EDITED }],
        },
    })
    // The edited text's one finding, and not an earlier publish still queued for this page.
    const published = await next(
        (message) =>
            message.method === 'textDocument/publishDiagnostics' &&
            (message.params as { uri: string }).uri === uri &&
            (message.params as { diagnostics: unknown[] }).diagnostics
                .length === 1,
    )
    expect(published.params).toMatchObject({ uri })
}, 60_000)

// A DELETED COMPONENT TAKES ITS CHECKED MODULE WITH IT. THE REVERT: drop the `CHECKED_SUFFIX` arm in
// `TypeSession.edited`; the page goes on checking `<Card title="x"/>` against the props the deleted
// file declared, and reports nothing.
test('a page importing a deleted component says it cannot find it — 38.11', async () => {
    const uri = Bun.pathToFileURL(`${app}/page.abide`).href
    await Bun.file(`${app}/ui/components/Card.abide`).delete()
    send({
        method: 'textDocument/didChange',
        params: {
            textDocument: { uri, version: 100 },
            contentChanges: [{ text: SAVED }],
        },
    })
    const published = await next(
        (message) =>
            message.method === 'textDocument/publishDiagnostics' &&
            (message.params as { uri: string }).uri === uri &&
            (
                message.params as { diagnostics: { code?: number }[] }
            ).diagnostics.some((diagnostic) => diagnostic.code === 2307),
    )
    expect(published.params).toMatchObject({ uri })
}, 60_000)

// 34.24 — WHAT A PLAIN `.ts` READS AN OPEN FILE BY FOLLOWS THE EDITOR'S TEXT, never saved: the
// language server writes the file's types beside the build as it checks it. THE REVERT: drop
// `typesFor` from `run` in `serveLanguage.ts`; nothing is written, and this waits out its poll.
test("an edited file's types follow the editor's text — 34.24", async () => {
    const uri = Bun.pathToFileURL(`${app}/page.abide`).href
    send({
        method: 'textDocument/didChange',
        params: {
            textDocument: { uri, version: 40 },
            contentChanges: [
                {
                    text: `<script module>\nexport const editedOnly = 1\n</script>\n\n${SAVED}`,
                },
            ],
        },
    })
    await next(
        (message) => message.method === 'textDocument/publishDiagnostics',
    )
    const types = Bun.file(
        `${dirname(app)}/.abide/types/${basename(app)}/page.abide.ts`,
    )
    let text = ''
    for (let turn = 0; turn < 100 && !text.includes('editedOnly'); turn += 1) {
        await Bun.sleep(50)
        text = (await types.exists()) ? await types.text() : ''
    }
    expect(text).toContain('export const editedOnly = 1')
}, 60_000)

// 38.98, 27.13 — `config().` OFFERS WHAT AN `onConfig` IT NEVER IMPORTED DEFAULTS, beside what abide
// derives. THE REVERT: drop the `textDocument/completion` case; the request is refused (-32601).
test('a completion offers the fields onConfig declared — 38.98', async () => {
    const uri = Bun.pathToFileURL(`${app}/reading/page.abide`).href
    send({
        method: 'textDocument/didOpen',
        params: {
            textDocument: {
                uri,
                languageId: 'abide',
                version: 1,
                text: READING,
            },
        },
    })
    const lines = READING.split('\n')
    const line = lines.findIndex((text) => text.includes('config()'))
    send({
        id: 20,
        method: 'textDocument/completion',
        params: {
            textDocument: { uri },
            position: { line, character: (lines[line] as string).length },
            context: { triggerKind: 2, triggerCharacter: '.' },
        },
    })
    const answered = (await next((message) => message.id === 20)) as {
        result: { items: { label: string; kind: number }[] }
    }
    const labels = answered.result.items.map((item) => item.label)
    expect(labels).toContain('RETRIES')
    expect(labels).toContain('APP_NAME')

    // An identifier is a position the checker's API offers nothing at, and it is answered.
    send({
        id: 21,
        method: 'textDocument/completion',
        params: {
            textDocument: { uri },
            position: { line: line + 1, character: 'void '.length },
        },
    })
    expect(await next((message) => message.id === 21)).toMatchObject({
        result: null,
    })
}, 60_000)

// 38.39 — A `{#for}`'s ITEM AND INDEX HOVER AS THE BINDINGS THEY ARE, where the head names them.
// THE REVERT: write them into the projection as scaffolding (`for (const ${node.item} of …`); both
// hovers are null.
test("a {#for}'s item and index hover in its head — 38.39", async () => {
    const uri = Bun.pathToFileURL(`${app}/rows/page.abide`).href
    send({
        method: 'textDocument/didOpen',
        params: {
            textDocument: { uri, languageId: 'abide', version: 1, text: ROWS },
        },
    })
    const lines = ROWS.split('\n')
    const line = lines.findIndex((text) => text.startsWith('{#for'))
    const hover = async (id: number, name: string): Promise<unknown> => {
        send({
            id,
            method: 'textDocument/hover',
            params: {
                textDocument: { uri },
                position: {
                    line,
                    character: (lines[line] as string).indexOf(name) + 1,
                },
            },
        })
        return (await next((message) => message.id === id)) as unknown
    }
    expect(await hover(30, 'path,')).toMatchObject({
        result: { contents: { value: '```ts\nconst path: string\n```' } },
    })
    expect(await hover(31, 'index')).toMatchObject({
        result: { contents: { value: '```ts\nconst index: number\n```' } },
    })
}, 60_000)

test('the server shuts down when asked — 38.11', async () => {
    send({ id: 2, method: 'shutdown' })
    expect(await next((message) => message.id === 2)).toMatchObject({
        result: null,
    })
    send({ method: 'exit' })
    expect(await server?.exited).toBe(0)
}, 60_000)
