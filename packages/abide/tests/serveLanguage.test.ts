// 38.11 — `abide lsp`, OVER STDIO, as an editor drives it: the handshake, a document opened with text
// that was never saved, a change that fixes it, and the shutdown. What it publishes is what `abide
// check` finds (38.3), on the line and character the editor shows — the editor's text, not the
// disk's.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { DOCS_SITE } from '#compiler/DOCS_SITE.ts'
import { appFixture } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

const BIN = new URL('../bin/abide.ts', import.meta.url).pathname

const SAVED = `<script>
import { reactive } from '@abide/abide'
import Card from './lib/Card.abide'

let count = reactive(0)
</script>

<p>{count.toFixed(1)}</p>
<Card title="x"/>`

// Never written to disk — only the editor holds it.
const EDITED = `<script>
import { reactive } from '@abide/abide'
import Card from './lib/Card.abide'

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
import { later } from '../lib/extra.ts'
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

// 38.116 — a reactive read by name in markup, a shorthand binding, and a `.ts` export another page
// reads too.
const REFS = `<script>
import { reactive } from '@abide/abide'
import { total } from '../lib/total.ts'

let count = reactive(total)
const { label } = { label: 'x' }
</script>

<p>{count}{label}</p>
<button onclick={() => count++}>{count.toFixed(1)}</button>`

const OTHERS = `<script>
import { total } from '../lib/total.ts'
</script>

<p>{total}</p>`

const BADGE = `<script>
import { props } from '@abide/abide'

const { tone, size } = props<{ tone: string; size?: number }>()
</script>

<p>{tone}{size}</p>`

const TAGS = `<script>
import Badge from '../lib/Badge.abide'
</script>

{#if true}<Badge tone="x"/>{/if}`

// 38.116 — a prop passed by a tag, and a component closed by a tag of its own.
const PANEL = `<script>
import { props } from '@abide/abide'

const { heading } = props<{ heading: string }>()
</script>

<h2>{heading}</h2>`

const PANELS = `<script>
import Panel from '../lib/Panel.abide'
</script>

<Panel heading="a"></Panel>
<Panel heading={'b'}/>`

const ELSEWHERE = `<script>
import Panel from '../lib/Panel.abide'
</script>

<Panel heading="c"></Panel>`

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
        'index.abide': SAVED,
        'lib/Card.abide': CARD,
        'lib/extra.ts': 'export const extra = 1\n',
        'more/index.abide': LATER,
        'reading/index.abide': READING,
        'rows/index.abide': ROWS,
        'refs/index.abide': REFS,
        'others/index.abide': OTHERS,
        'lib/total.ts': 'export const total = 1\n',
        'lib/Badge.abide': BADGE,
        'tags/index.abide': TAGS,
        'lib/Panel.abide': PANEL,
        'panels/index.abide': PANELS,
        'elsewhere/index.abide': ELSEWHERE,
        'refused/index.abide': '<p>x</p>',
        'settings/index.abide': `<script server>
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
    const uri = Bun.pathToFileURL(`${app}/index.abide`).href
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
    const uri = Bun.pathToFileURL(`${app}/index.abide`).href
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
                uri: Bun.pathToFileURL(`${app}/lib/Card.abide`).href,
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
    const card = Bun.pathToFileURL(`${app}/lib/Card.abide`).href
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
    const uri = Bun.pathToFileURL(`${app}/more/index.abide`).href
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
        `${app}/lib/extra.ts`,
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
    const uri = Bun.pathToFileURL(`${app}/index.abide`).href
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
    const uri = Bun.pathToFileURL(`${app}/index.abide`).href
    await Bun.file(`${app}/lib/Card.abide`).delete()
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

// 38.98, 27.13 — `config().` OFFERS WHAT AN `onConfig` IT NEVER IMPORTED DEFAULTS, beside what abide
// derives. THE REVERT: drop the `textDocument/completion` case; the request is refused (-32601).
test('a completion offers the fields onConfig declared — 38.98', async () => {
    const uri = Bun.pathToFileURL(`${app}/reading/index.abide`).href
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
    const uri = Bun.pathToFileURL(`${app}/rows/index.abide`).href
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

type Range = {
    start: { line: number; character: number }
    end: { line: number; character: number }
}

// The edits a rename answers with in one file, as `line:character text`, in order.
function editsIn(
    changes: Record<string, { range: Range; newText: string }[]>,
    uri: string,
): string[] {
    const edits: string[] = []
    for (const edit of changes[uri] ?? [])
        edits.push(
            `${edit.range.start.line}:${edit.range.start.character} ${edit.newText}`,
        )
    return edits.sort()
}

async function opened(uri: string, text: string): Promise<void> {
    send({
        method: 'textDocument/didOpen',
        params: {
            textDocument: { uri, languageId: 'abide', version: 1, text },
        },
    })
    await next(
        (message) =>
            message.method === 'textDocument/publishDiagnostics' &&
            (message.params as { uri: string }).uri === uri,
    )
}

// 38.116 — A RENAME ASKED AT A REACTIVE'S DECLARATION EDITS ITS MARKUP USES TOO. THE REVERT: ask the
// checked module alone (`placesFrom` answering `fromSource`'s one place); the markup reads are
// rewrites there, and the rename edits the declaration alone.
test("a rename edits a reactive's declaration and its uses in markup — 38.116", async () => {
    const uri = Bun.pathToFileURL(`${app}/refs/index.abide`).href
    await opened(uri, REFS)
    const lines = REFS.split('\n')
    const declared = lines.findIndex((text) => text.startsWith('let count'))
    send({
        id: 40,
        method: 'textDocument/rename',
        params: {
            textDocument: { uri },
            position: { line: declared, character: 5 },
            newName: 'tally',
        },
    })
    const renamed = (await next((message) => message.id === 40)) as {
        result: { changes: Record<string, { range: Range; newText: string }[]> }
    }
    const markup = lines.findIndex((text) => text.startsWith('<p>'))
    const button = markup + 1
    const row = lines[button] as string
    expect(editsIn(renamed.result.changes, uri)).toEqual(
        [
            `${declared}:4 tally`,
            `${markup}:4 tally`,
            `${button}:${row.indexOf('count++')} tally`,
            `${button}:${row.indexOf('count.toFixed')} tally`,
        ].sort(),
    )

    // A SHORTHAND KEEPS THE PROPERTY IT NAMES. THE REVERT: write the new name over a shorthand as
    // over any other place; the binding reads a property the object does not have.
    const binding = lines.findIndex((text) => text.startsWith('const { label'))
    const label = (lines[markup] as string).indexOf('label')
    send({
        id: 41,
        method: 'textDocument/rename',
        params: {
            textDocument: { uri },
            position: { line: markup, character: label },
            newName: 'caption',
        },
    })
    const shorthand = (await next((message) => message.id === 41)) as {
        result: { changes: Record<string, { range: Range; newText: string }[]> }
    }
    expect(editsIn(shorthand.result.changes, uri)).toEqual(
        [`${binding}:8 label: caption`, `${markup}:${label} caption`].sort(),
    )

    // A LIBRARY'S NAME IS NOT RENAMED, and the editor is told before it asks for a new one.
    send({
        id: 42,
        method: 'textDocument/prepareRename',
        params: {
            textDocument: { uri },
            position: { line: button, character: row.indexOf('toFixed') + 1 },
        },
    })
    expect(await next((message) => message.id === 42)).toMatchObject({
        error: { code: -32803 },
    })
    send({
        id: 43,
        method: 'textDocument/prepareRename',
        params: {
            textDocument: { uri },
            position: { line: declared, character: 5 },
        },
    })
    expect(await next((message) => message.id === 43)).toMatchObject({
        result: {
            range: {
                start: { line: declared, character: 4 },
                end: { line: declared, character: 9 },
            },
            placeholder: 'count',
        },
    })
}, 60_000)

// 38.116 — A `.ts` EXPORT'S REFERENCES ARE EVERY PAGE'S, open or not, imported by this one or not.
// THE REVERT: drop `lowerApp` from the references question; `others/index.abide` is in no program,
// and only this page and the `.ts` are found.
test('references reach a .ts and a page nobody opened — 38.116', async () => {
    const uri = Bun.pathToFileURL(`${app}/refs/index.abide`).href
    const line = REFS.split('\n').findIndex((text) =>
        text.includes('{ total }'),
    )
    send({
        id: 44,
        method: 'textDocument/references',
        params: {
            textDocument: { uri },
            position: { line, character: 10 },
            context: { includeDeclaration: true },
        },
    })
    const found = (await next((message) => message.id === 44)) as {
        result: { uri: string; range: Range }[]
    }
    const files = new Set(found.result.map((location) => location.uri))
    expect([...files].sort()).toEqual(
        [
            uri,
            Bun.pathToFileURL(`${app}/others/index.abide`).href,
            Bun.pathToFileURL(`${app}/lib/total.ts`).href,
        ].sort(),
    )
    const others = OTHERS.split('\n')
    const last = others[others.length - 1] as string
    expect(
        found.result
            .filter((location) => location.uri.endsWith('others/index.abide'))
            .map((location) => location.range.start)
            .sort((one, two) => one.line - two.line),
    ).toEqual([
        { line: 1, character: 9 },
        { line: others.length - 1, character: last.indexOf('total') },
    ])
}, 60_000)

// Asks a rename at `line`, `character` in `uri`, and answers each file's edits (`editsIn`), by the
// file's path below the app.
async function renamedAt(
    id: number,
    uri: string,
    line: number,
    character: number,
    newName: string,
): Promise<Record<string, string[]>> {
    send({
        id,
        method: 'textDocument/rename',
        params: {
            textDocument: { uri },
            position: { line, character },
            newName,
        },
    })
    const renamed = (await next((message) => message.id === id)) as {
        result: { changes: Record<string, { range: Range; newText: string }[]> }
    }
    const byFile: Record<string, string[]> = {}
    for (const file of Object.keys(renamed.result.changes))
        byFile[file.slice(Bun.pathToFileURL(app).href.length + 1)] = editsIn(
            renamed.result.changes,
            file,
        )
    return byFile
}

// 38.116 — A PROP IS RENAMED WHERE A TAG PASSES IT, in every page that does, from the prop's side and
// from the attribute's. THE REVERT: write a component's attribute keys as scaffolding again
// (`JSON.stringify(key)` in `projectShadow`'s invocation); the declaration's side renames Panel alone,
// and a rename asked at an attribute answers nothing. Or ask no place again where the checked module
// copies the props type twice (`TypeSession.references`); asked at the attribute, the shorthand
// binding keeps the old name.
test("a prop's rename reaches every tag passing it — 38.116", async () => {
    const panel = Bun.pathToFileURL(`${app}/lib/Panel.abide`).href
    const panels = Bun.pathToFileURL(`${app}/panels/index.abide`).href
    await opened(panel, PANEL)
    await opened(panels, PANELS)
    const declared = PANEL.split('\n').findIndex((text) =>
        text.startsWith('const { heading'),
    )
    const declaration = PANEL.split('\n')[declared] as string
    const passing = PANELS.split('\n')
    const open = passing.findIndex((text) =>
        text.startsWith('<Panel heading="a"'),
    )
    const expected = {
        'lib/Panel.abide': [
            `${declared}:8 title: heading`,
            `${declared}:${declaration.lastIndexOf('heading')} title`,
        ].sort(),
        'panels/index.abide': [`${open}:7 title`, `${open + 1}:7 title`],
        'elsewhere/index.abide': ['4:7 title'],
    }
    expect(
        await renamedAt(
            60,
            panel,
            declared,
            declaration.lastIndexOf('heading') + 1,
            'title',
        ),
    ).toEqual(expected)
    expect(await renamedAt(61, panels, open + 1, 8, 'title')).toEqual(expected)
}, 60_000)

// 38.116 — A COMPONENT IS RENAMED AT A CLOSE TAG OF ITS OWN as at its open tag, asked at either, and a
// self-closing tag is the one place. THE REVERT: drop the close tag's read from `projectShadow`'s
// invocation; the close tags keep the old name, and a rename asked at one answers nothing.
test('a component is renamed at its close tags too — 38.116', async () => {
    const panels = Bun.pathToFileURL(`${app}/panels/index.abide`).href
    const passing = PANELS.split('\n')
    const imported = passing.findIndex((text) =>
        text.startsWith('import Panel'),
    )
    const open = passing.findIndex((text) =>
        text.startsWith('<Panel heading="a"'),
    )
    const closeAt = (passing[open] as string).indexOf('</Panel>') + 2
    // A default import's rename is every importer's, as the checker answers it.
    const elsewhere = ELSEWHERE.split('\n')
    const elsewhereOpen = elsewhere.length - 1
    const expected = {
        'panels/index.abide': [
            `${imported}:7 Card2`,
            `${open}:1 Card2`,
            `${open}:${closeAt} Card2`,
            `${open + 1}:1 Card2`,
        ].sort(),
        'elsewhere/index.abide': [
            '1:7 Card2',
            `${elsewhereOpen}:1 Card2`,
            `${elsewhereOpen}:${(elsewhere[elsewhereOpen] as string).indexOf('</Panel>') + 2} Card2`,
        ],
    }
    expect(await renamedAt(62, panels, imported, 8, 'Card2')).toEqual(expected)
    expect(await renamedAt(63, panels, open, closeAt + 1, 'Card2')).toEqual(
        expected,
    )
}, 60_000)

// 38.117 — MARKUP OFFERS WHAT MARKUP TAKES: the blocks the parser reads after `{#`, the arms and the
// close of the block still open after `{:` and `{/`, the components in scope after `<`, and a
// component's props not yet written inside its tag. THE REVERT: drop the `templateContext` arm of
// `TypeSession.complete`; every one of these is answered null.
test('markup completes blocks, component tags and their props — 38.117', async () => {
    const uri = Bun.pathToFileURL(`${app}/tags/index.abide`).href
    await opened(uri, TAGS)
    const labelsAt = async (
        id: number,
        text: string,
        version: number,
    ): Promise<string[]> => {
        send({
            method: 'textDocument/didChange',
            params: {
                textDocument: { uri, version },
                contentChanges: [{ text }],
            },
        })
        const lines = text.split('\n')
        send({
            id,
            method: 'textDocument/completion',
            params: {
                textDocument: { uri },
                position: {
                    line: lines.length - 1,
                    character: (lines[lines.length - 1] as string).length,
                },
            },
        })
        const answered = (await next((message) => message.id === id)) as {
            result: { items: { label: string }[] } | null
        }
        return (answered.result?.items ?? []).map((item) => item.label).sort()
    }
    const head = TAGS.slice(0, TAGS.indexOf('{#if'))
    expect(await labelsAt(50, `${head}{#`, 2)).toEqual([
        'component',
        'for',
        'if',
        'try',
    ])
    expect(await labelsAt(51, `${head}{#try}x{:`, 3)).toEqual([
        'catch',
        'finally',
    ])
    expect(await labelsAt(52, `${head}{#if true}<p>x</p>{/`, 4)).toEqual(['if'])
    expect(await labelsAt(53, `${head}<`, 5)).toEqual(['Badge'])
    expect(await labelsAt(54, `${head}<Badge tone="x" `, 6)).toEqual(['size'])
}, 60_000)

// 38.118 — AN ABIDE FINDING CARRIES THE CLAUSE IT CITES as its code, linked to the rulebook's page.
// THE REVERT: publish `code` only where the checker numbered the finding; this one carries none.
test('a finding citing a clause carries it as its code — 38.118', async () => {
    const uri = Bun.pathToFileURL(`${app}/refused/index.abide`).href
    send({
        method: 'textDocument/didOpen',
        params: {
            textDocument: {
                uri,
                languageId: 'abide',
                version: 1,
                text: '<p>{:finally}</p>',
            },
        },
    })
    const published = await next(
        (message) =>
            message.method === 'textDocument/publishDiagnostics' &&
            (message.params as { uri: string }).uri === uri,
    )
    expect(published.params).toMatchObject({
        diagnostics: [
            {
                code: '32.56',
                codeDescription: { href: `${DOCS_SITE}/rulebook#32.56` },
            },
        ],
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
