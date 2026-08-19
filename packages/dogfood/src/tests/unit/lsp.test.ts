// The language server, as a conversation.
//
// `cli.test.ts` spawns the binary because every claim it makes is about a process. This one mostly
// does not, and for the mirror-image reason: a claim about a language server is a claim about what
// came back after what was said, and the way to make one is to hand it the exchange. The server
// takes its transport as hooks for exactly that — the same shape the REPL's line editor takes its
// terminal in — so a whole session is a string of frames in and a list of messages out.
//
// Reached through `abide/cli`, the public specifier, so a broken entry point fails here.

import { expect, test } from 'bun:test'
import { type LanguageHooks, LanguageServer, type Range } from 'abide/cli'
import { BINDABLE, BRANCHES, VOID_ELEMENTS } from 'abide/compiler'
import { emitFor } from 'abide/compiler/check'
import { LiveCheck } from 'abide/compiler/live'
import { abide, BINARY } from 'harness/spawn'
import { APP_ROOT, REPO_ROOT, TYPES } from '#tests/PATHS.ts'

const FIXTURES = `${APP_ROOT}/src/shared/demos/fixtures`

const ENCODER = new TextEncoder()
const DECODER = new TextDecoder()

const URI = 'file:///tmp/Probe.abide'

interface Message {
    id?: number
    method?: string
    result?: unknown
    error?: { code: number; message: string }
    params?: {
        uri: string
        diagnostics: { range: Range; message: string; severity?: number; code?: string }[]
    }
}

function frame(message: unknown): Uint8Array {
    const body = ENCODER.encode(JSON.stringify(message))
    const header = ENCODER.encode(`Content-Length: ${body.length}\r\n\r\n`)
    return new Uint8Array(Bun.concatArrayBuffers([header, body]))
}

/**
 * Everything the server said, unframed — which is the only thing any assertion below looks at.
 *
 * Read the way a CLIENT reads it: the declared length is believed and the body is sliced to it, in
 * bytes. Splitting on the header and taking the rest of the buffer would parse fine against a
 * `Content-Length` that was counting UTF-16 code units, and every case in this file would be green
 * against a server no editor could talk to.
 */
function said(written: Uint8Array[]): Message[] {
    const bytes = new Uint8Array(Bun.concatArrayBuffers(written))
    const out: Message[] = []
    let at = 0
    while (at < bytes.length) {
        const header = DECODER.decode(bytes.subarray(at, at + 64))
        const blank = header.indexOf('\r\n\r\n')
        const declared = /Content-Length: (\d+)/.exec(header)
        if (blank === -1 || declared === null) break
        const from = at + blank + 4
        const length = Number(declared[1])
        out.push(JSON.parse(DECODER.decode(bytes.subarray(from, from + length))) as Message)
        at = from + length
    }
    return out
}

/** A server with no checker behind it, which is the whole surface these cases are about. */
function opened(text: string): { server: LanguageServer; written: Uint8Array[] } {
    const written: Uint8Array[] = []
    const hooks: LanguageHooks = { write: (message) => written.push(message), exit: () => {} }
    const server = new LanguageServer(hooks)
    server.feed(frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }))
    server.feed(
        frame({
            jsonrpc: '2.0',
            method: 'textDocument/didOpen',
            params: { textDocument: { uri: URI, version: 1, text } },
        }),
    )
    return { server, written }
}

/** The offset of `needle`'s LAST character plus one — where a cursor sits having just typed it. */
function after(text: string, needle: string): { line: number; character: number } {
    const at = text.indexOf(needle) + needle.length
    const before = text.slice(0, at)
    return { line: before.split('\n').length - 1, character: at - (before.lastIndexOf('\n') + 1) }
}

function ask(server: LanguageServer, id: number, method: string, position: unknown): void {
    server.feed(frame({ jsonrpc: '2.0', id, method, params: { textDocument: { uri: URI }, position } }))
}

function answered(written: Uint8Array[], id: number): Message | undefined {
    for (const message of said(written)) if (message.id === id) return message
    return undefined
}

/** The result of one answer. THROWN for rather than typed optional: a missing reply is the failure. */
function resultOf<Result>(written: Uint8Array[], id: number): Result {
    const message = answered(written, id)
    if (message === undefined) throw new Error(`nothing answered request ${id}`)
    return message.result as Result
}

/** The labels of a completion answer, which is what every case below compares against a table. */
function labels(written: Uint8Array[], id: number): string[] {
    const items = resultOf<{ label: string }[]>(written, id)
    const out: string[] = []
    for (const item of items) out.push(item.label)
    return out
}

/** The markdown of a hover answer. */
function hovered(written: Uint8Array[], id: number): string {
    return resultOf<{ contents: { value: string } }>(written, id).contents.value
}

// `Content-Length` counts BYTES and a JavaScript string is counted in UTF-16 code units, so the two
// part company the moment a page holds anything outside ASCII — which is every page with a `·` in
// it. The claim is that the two readings agree, and it is made by driving the SAME conversation
// twice: once as one chunk, and once one byte at a time, which is also the only way to say that a
// message split across two reads is still one message. Written against a document with a multi-byte
// character in it precisely because a document without one passes either way.
test('a session is the same session however the bytes arrive', () => {
    // A `·` is one code unit and two bytes, which is the whole of the disagreement. The `didOpen`
    // carrying it is in the MIDDLE of the conversation on purpose: a frame measured in code units is
    // one character short of its own body, and the character it takes instead comes off the frame
    // AFTER it — so a mis-measured message at the end of a buffer parses fine and says nothing.
    const text = '<main>\n    <p>count · {broken</p>\n</main>\n'
    const conversation = new Uint8Array(Bun.concatArrayBuffers([
        frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
        frame({
            jsonrpc: '2.0',
            method: 'textDocument/didOpen',
            params: { textDocument: { uri: URI, version: 1, text } },
        }),
        frame({ jsonrpc: '2.0', id: 2, method: 'shutdown' }),
    ]))

    const whole: Uint8Array[] = []
    const bulk = new LanguageServer({ write: (message) => whole.push(message), exit: () => {} })
    bulk.feed(conversation)

    const dribbled: Uint8Array[] = []
    const trickle = new LanguageServer({ write: (message) => dribbled.push(message), exit: () => {} })
    for (let at = 0; at < conversation.length; at++) trickle.feed(conversation.subarray(at, at + 1))

    expect(said(dribbled)).toEqual(said(whole))
    // And it is a real session rather than two empty ones agreeing: three messages in, three out,
    // and the middle one is the diagnostic saying the document is broken.
    expect(said(whole)).toHaveLength(3)
    expect(said(whole)[1]?.params?.diagnostics).toHaveLength(1)
    expect(said(whole)[2]?.id).toBe(2)
})

test('a parse failure is a range over the marker that failed, not a line number', () => {
    const text = '<main>\n    {#whip x}\n        <b>no</b>\n    {/whip}\n</main>\n'
    const { written } = opened(text)

    const published = said(written)[1]
    expect(published?.method).toBe('textDocument/publishDiagnostics')
    const found = published?.params?.diagnostics ?? []
    expect(found).toHaveLength(1)
    expect(found[0]?.message).toBe('unknown block {#whip}')
    // `{#whip` — the whole marker, on the line it is on. A diagnostic that named the file and the
    // line would pass a laxer assertion and put the squiggle in the wrong place.
    expect(found[0]?.range).toEqual({
        start: { line: 1, character: 4 },
        end: { line: 1, character: 10 },
    })
    expect(text.split('\n')[1]?.slice(4, 10)).toBe('{#whip')
})

// The point is not that `if` is offered. It is that the list IS `BRANCHES`, so a sixth block cannot
// be one the compiler accepts and the editor has never heard of — the same guarantee `/docs/syntax`
// gets, arrived at from the other end.
test("the blocks offered are the compiler's own table, and its branches are too", () => {
    const blocks = '<main>\n    {#\n</main>\n'
    const first = opened(blocks)
    ask(first.server, 2, 'textDocument/completion', after(blocks, '{#'))
    const offered = labels(first.written, 2)
    expect(offered.sort()).toEqual(Object.keys(BRANCHES).sort())

    const branches = '<main>\n    {#for row of rows}\n        {:\n    {/for}\n</main>\n'
    const second = opened(branches)
    ask(second.server, 2, 'textDocument/completion', after(branches, '{:'))
    const inside = labels(second.written, 2)
    expect(inside.sort()).toEqual(Object.keys(BRANCHES.for as object).sort())
})

// Full sync: the whole buffer arrives on every edit, and the answer has to be about the text that
// arrived rather than the one the file was opened with. A server that kept the first copy would pass
// every case above, because every case above opens a document and never changes it.
test('an edit republishes against the text that arrived, not the one on open', () => {
    const { server, written } = opened('<main>\n    <b>fine</b>\n</main>\n')
    expect(said(written)[1]?.params?.diagnostics).toEqual([])

    server.feed(
        frame({
            jsonrpc: '2.0',
            method: 'textDocument/didChange',
            params: {
                textDocument: { uri: URI, version: 2 },
                contentChanges: [{ text: '<main>\n    {#whip}\n</main>\n' }],
            },
        }),
    )
    const last = said(written)[said(written).length - 1]
    expect(last?.params?.diagnostics?.[0]?.message).toBe('unknown block {#whip}')
    expect(last?.params?.diagnostics?.[0]?.range.start.line).toBe(1)
})

// The half-typed `{:` above already means this file does not parse, and that is the case rather than
// an accident of the fixture: an editor asks what may follow `{:` at exactly the moment there is an
// unclosed block in the file, so an answer read off the parse tree is an answer that never arrives.
test('a branch is completed inside a block on a file that does not parse', () => {
    const text = '<main>\n    {#try}\n        <b>x</b>\n    {:c\n</main>\n'
    const { server, written } = opened(text)

    expect(said(written)[1]?.params?.diagnostics ?? []).not.toHaveLength(0)
    ask(server, 2, 'textDocument/completion', after(text, '{:c'))
    const offered = labels(written, 2)
    expect(offered).toEqual(['catch'])
})

test('a bind target is filtered by the tag it is being written on', () => {
    const text = '<main>\n    <details bind:></details>\n    <input bind: />\n</main>\n'
    const { server, written } = opened(text)

    ask(server, 2, 'textDocument/completion', after(text, '<details bind:'))
    const forDetails = labels(written, 2)
    expect(forDetails).toEqual(['open'])

    ask(server, 3, 'textDocument/completion', after(text, '<input bind:'))
    const forInput = labels(written, 3)
    const accepts: string[] = []
    for (const target in BINDABLE) {
        if ((BINDABLE[target] as Record<string, unknown>).input !== undefined) accepts.push(target)
    }
    expect(forInput.sort()).toEqual(accepts.sort())
})

// `bind:value` settles on `input` for a text field and on `change` for a `<select>`, and the row in
// `BINDABLE` says so per tag. A hover that reduced the row to one event was right about a third of
// it and confidently wrong about the rest, which is the failure a test naming only `<input>` cannot
// see.
test('hover over a bind target names each tag with its own event', () => {
    const text = '<main>\n    <select bind:value={choice}></select>\n</main>\n'
    const { server, written } = opened(text)

    ask(server, 2, 'textDocument/hover', after(text, 'bind:val'))
    const value = hovered(written, 2)
    expect(value).toContain('`<input>` on `input`')
    expect(value).toContain('`<textarea>` on `input`')
    expect(value).toContain('`<select>` on `change`')
})

// `{:else if c}` is legal and was undiscoverable: it is the `else` keyword carrying a condition, so a
// table of branch NAMES could only ever show `{:else}`. The tail is in the table now, which is what
// lets this assert the spelling rather than the keyword.
test('hover over a block spells a branch that carries something, both ways', () => {
    const text = '{#if a}<p>x</p>{:else}<p>y</p>{/if}\n'
    const { server, written } = opened(text)
    ask(server, 2, 'textDocument/hover', after(text, '{#i'))
    const value = hovered(written, 2)
    expect(value).toContain('`{:else}`')
    expect(value).toContain('`{:else if <condition>}`')
})

test('hover over a block says which branches it takes', () => {
    const text = '<main>\n    {#switch mode}\n        {:default}<b>x</b>\n    {/switch}\n</main>\n'
    const { server, written } = opened(text)

    ask(server, 2, 'textDocument/hover', after(text, '{#swit'))
    const value = hovered(written, 2)
    for (const branch in BRANCHES.switch as object) expect(value).toContain(`{:${branch}`)
})

// A request with an id and no reply is a client waiting forever, which is the one way a language
// server hangs an editor rather than merely disappointing it. Notifications are the opposite rule —
// there is nothing to wait for — so the two are asserted together.
test('a request it cannot answer is refused, and a notification it cannot is ignored', () => {
    const { server, written } = opened('<main>x</main>\n')
    const before = said(written).length

    // `textDocument/references` and not `textDocument/definition`, which this once used and which is
    // now answered — the refusal has to be spelled with something genuinely unimplemented or the case
    // passes for as long as nobody adds the method it names.
    server.feed(frame({ jsonrpc: '2.0', id: 7, method: 'textDocument/references', params: {} }))
    server.feed(frame({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id: 7 } }))

    expect(said(written)).toHaveLength(before + 1)
    expect(answered(written, 7)?.error?.code).toBe(-32601)
})

// The EXTENSION decides what this server has anything to say about. A `.ts` file sent here parses as
// markup and produces no diagnostic either way, so the visible half of the mistake is silent — what
// it would actually cost is a `foo.ts.ts` written into the mirror that the mirror's own sweep does
// not recognise as its own and therefore never removes.
test("a file that is not `.abide` is not this server's to answer about", () => {
    const written: Uint8Array[] = []
    const server = new LanguageServer({ write: (message) => written.push(message), exit: () => {} })
    server.feed(
        frame({
            jsonrpc: '2.0',
            method: 'textDocument/didOpen',
            params: {
                textDocument: { uri: 'file:///tmp/models.ts', version: 1, text: 'export const x = 1\n' },
            },
        }),
    )
    expect(said(written)).toHaveLength(0)

    // …and it is not merely holding its tongue: it never took the document, so a position request
    // against it has nothing to answer either.
    server.feed(
        frame({
            jsonrpc: '2.0',
            id: 2,
            method: 'textDocument/hover',
            params: { textDocument: { uri: 'file:///tmp/models.ts' }, position: { line: 0, character: 8 } },
        }),
    )
    expect(resultOf(written, 2)).toBeNull()
})

test('closing a document takes its diagnostics with it', () => {
    const { server, written } = opened('<main>\n    {#whip}\n</main>\n')
    expect(said(written)[1]?.params?.diagnostics ?? []).toHaveLength(1)

    server.feed(
        frame({
            jsonrpc: '2.0',
            method: 'textDocument/didClose',
            params: { textDocument: { uri: URI } },
        }),
    )
    const last = said(written)[said(written).length - 1]
    expect(last?.method).toBe('textDocument/publishDiagnostics')
    // Emptied rather than left behind: a squiggle on a file nobody has open outlives the editor.
    expect(last?.params?.diagnostics).toEqual([])
})

/**
 * Read framed messages off a live child until one of them answers `wanted`.
 *
 * BOUNDED, and that is not politeness: a suite that hangs reports nothing at all — no failed test and
 * no summary — so a case waiting on a process that will never speak has to fail rather than wait.
 */
async function awaited(
    child: { stdout: ReadableStream<Uint8Array> },
    wanted: (message: Message) => boolean,
    within: number,
): Promise<Message> {
    const reader = child.stdout.getReader()
    const parts: Uint8Array[] = []
    const deadline = Bun.nanoseconds() + within * 1e6
    try {
        for (;;) {
            const left = (deadline - Bun.nanoseconds()) / 1e6
            // The bound has to be RACED against the read rather than checked around it: a server
            // that says nothing more leaves `read()` pending for ever, and a deadline the loop only
            // reaches between reads is never reached at all. That is not hypothetical — reverting
            // the buffer for the file made this wait out the runner's own timeout instead.
            const read = await Promise.race([reader.read(), Bun.sleep(Math.max(left, 0)).then(() => null)])
            if (read === null) throw new Error('the server said nothing that matched, in time')
            if (read.done) throw new Error('the server closed its output')
            if (read.value !== undefined) parts.push(read.value)
            for (const message of said(parts)) if (wanted(message)) return message
        }
    } finally {
        reader.releaseLock()
    }
}

/**
 * The whole thing as an editor has it: the binary, the real checker, and a type error on the line of
 * the `.abide` file somebody is looking at.
 *
 * The fixture is VALID on disk and the mistake is only ever in the buffer, which is what makes this
 * the distinguishing case — a server that checked the FILE reports nothing here and still passes
 * every other case above. The mirror is put back from disk at the end, because it is what
 * `bun run typecheck` resolves `./live.abide` through and this case left the unsaved version in it.
 */
test('an editor is told about a type error in the buffer, on the `.abide` line', async () => {
    const path = `${TYPES}/valid/live.abide`
    const uri = `file://${path}`
    const disk = await Bun.file(path).text()
    const edited = disk.replace('book.title', 'book.titel')
    expect(edited).not.toBe(disk)

    // `Bun.spawn` rather than the harness helper: this is the one case that has to hand the binary a
    // stdin, which is what `BINARY` is exported beside those helpers for.
    const child = Bun.spawn(['bun', BINARY, 'lsp'], {
        cwd: APP_ROOT,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
    })
    try {
        child.stdin.write(
            new Uint8Array(Bun.concatArrayBuffers([
                frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
                frame({
                    jsonrpc: '2.0',
                    method: 'textDocument/didOpen',
                    params: { textDocument: { uri, languageId: 'abide', version: 1, text: edited } },
                }),
            ])),
        )
        await child.stdin.flush()

        // The FIRST publish is the syntax pass and is empty — the buffer parses, it just does not
        // check. So the one waited for is the second, which only a checker can produce.
        const published = await awaited(
            child,
            (message) =>
                message.method === 'textDocument/publishDiagnostics' &&
                (message.params?.diagnostics.length ?? 0) > 0,
            15_000,
        )
        const found = published.params?.diagnostics[0]
        expect(found?.message).toContain("Property 'titel' does not exist")
        expect(found?.range.start.line).toBe(edited.split('\n').findIndex((line) => line.includes('titel')))
        // The checker's category and code, translated once and carried the whole way. Both are a
        // TABLE lookup with no other reader, so a reversed table produces a diagnostic that reads
        // perfectly and is filed as a hint: the message and the line above are green either way.
        expect(found?.severity).toBe(1)
        // TS2551 and not TS2339: the near-miss form, because `titel` is one edit from `title`. The
        // same distinction `types.test.ts` pins for its own fixtures — the code is the checker's, and
        // a test that accepted any `TS\d+` would not notice the table below it being reversed.
        expect(found?.code).toBe('TS2551')
    } finally {
        child.kill()
        await emitFor(path)
    }
}, 60_000)

// Spawned, because this is the one claim about the COMMAND rather than about the server: which files
// to look at is the editor's to say over the wire, so a root named on the command line would be a
// second answer to the same question.
test('`lsp` takes no arguments', async () => {
    const asked = await abide(['lsp', 'src/ui/pages'])
    expect(asked.code).toBe(2)
    expect(asked.err).toContain('takes no arguments')
    // stdin and stdout ARE the protocol, so a refusal may not land on stdout.
    expect(asked.out).toBe('')
})

// --- the type lane, and where it may be asked ------------------------------
//
// A hover is answered from THREE places now — the block table, the bind table, and a program in
// another process — and the interesting claim is not that the third one works. It is WHERE it is
// allowed to be asked: a source mapping is anchored at the start of each expression and carries no
// extent, so a position in the markup after `{book.title}` maps into the middle of that expression
// rather than to nothing. `holeAt` is the bound, and a stub hook is what makes the bound observable
// — the real checker would answer `null` for a bad position and look identical to not being asked.

/** A server whose type hook records every position it was asked about, and always answers. */
function typing(text: string): {
    server: LanguageServer
    written: Uint8Array[]
    asked: { line: number; character: number }[]
} {
    const written: Uint8Array[] = []
    const asked: { line: number; character: number }[] = []
    const server = new LanguageServer({
        write: (message) => written.push(message),
        exit: () => {},
        typeAt: async (_document, line, character) => {
            asked.push({ line, character })
            return { type: 'string', docs: null }
        },
    })
    server.feed(frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }))
    server.feed(
        frame({
            jsonrpc: '2.0',
            method: 'textDocument/didOpen',
            params: { textDocument: { uri: URI, version: 1, text } },
        }),
    )
    return { server, written, asked }
}

test('a type is asked for where a mapping exists, and nowhere else', async () => {
    const text = '<script module>\nconst title = 1\n</script>\n<p class="row">{title}</p>\n<p>plain</p>\n'
    const { server, written, asked } = typing(text)

    // The two places a `.abide` carries a mapping — a `<script>` body and a `{…}` — then three that
    // do not: text, an attribute name, and a tag. Each of the three sits AFTER a hole on its line or
    // on a line with no mapping at all, which is exactly when an unbounded ask stops being quiet and
    // starts answering about the nearest expression instead.
    ask(server, 2, 'textDocument/hover', after(text, 'const ti'))
    ask(server, 3, 'textDocument/hover', after(text, '{ti'))
    ask(server, 4, 'textDocument/hover', after(text, 'pl'))
    ask(server, 5, 'textDocument/hover', after(text, 'cl'))
    ask(server, 6, 'textDocument/hover', after(text, '</p>\n<p'))
    await Bun.sleep(20)

    // The script body is the half that was missing while a body had no segments: bounding the ask to
    // a hole outlived the gap it was written for, and a hover over a `<script>` answered null having
    // never asked — which reads exactly like a checker with nothing to say.
    expect(asked).toHaveLength(2)
    expect(hovered(written, 2)).toBe('```ts\nstring\n```')
    expect(hovered(written, 3)).toBe('```ts\nstring\n```')
    for (const id of [4, 5, 6]) expect(resultOf<unknown>(written, id)).toBeNull()
})

// A comment is not an expression, and the checker asked about a position in one falls back to the
// FILE — which is the generated mirror, so the hover read `typeof import("…/.abide/types/…")`: a path
// the author never wrote, naming a module they cannot open. Guarded twice, because the two guards
// catch it at different places: a comment-only line is never marked, and this is the same answer
// arriving from a trailing comment on a line that IS marked.
test('a hover never answers with the generated module', async () => {
    const written: Uint8Array[] = []
    const server = new LanguageServer({
        write: (message) => written.push(message),
        exit: () => {},
        typeAt: async () => ({ type: 'typeof import("/tmp/.abide/types/Probe.abide")', docs: null }),
    })
    const text = '<script module>\nconst n = 1 // a note\n</script>\n<p>{n}</p>\n'
    server.feed(frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }))
    server.feed(
        frame({
            jsonrpc: '2.0',
            method: 'textDocument/didOpen',
            params: { textDocument: { uri: URI, version: 1, text } },
        }),
    )
    ask(server, 2, 'textDocument/hover', after(text, '// a no'))
    await Bun.sleep(20)
    expect(resultOf<unknown>(written, 2)).toBeNull()
})

// An IMPORT is the one statement the source map cannot place: it is lifted to the top of the emitted
// module and merged with the emitter's own, so there is nothing in the output that is only it. It is
// answered from the text instead — which is also why this case costs no checker and no emit, and why
// it is here rather than beside the spawned one at the bottom of the file.
// Every name a `.abide` file uses is IMPORTED, so the symbol under the cursor is the local binding
// and its own doc comment is the empty one nobody wrote. Without the alias hop `state` — the most
// used callable in the framework — hovered with no explanation, its doc comment one module away.
test('a hover carries the doc comment from the module a name was imported from', async () => {
    const path = `${TYPES}/valid/live.abide`
    const text = await Bun.file(path).text()
    const live = new LiveCheck()
    try {
        const offset = text.indexOf('state({ title') + 2
        const before = text.slice(0, offset)
        const found = await live.typeAt(
            path,
            text,
            before.split('\n').length - 1,
            offset - (before.lastIndexOf('\n') + 1),
        )
        expect(found?.docs).toContain('A cell holding a value you write yourself')
    } finally {
        live.close()
    }
}, 120_000)

// The mapping is per LINE, so a column drifts by whatever the desugar inserted before it — here
// `shelf.filter(…)` becomes `shelf().filter(…)`, two characters ahead of the cursor. The child
// refuses an answer whose position landed on a DIFFERENT identifier, and this is the other side of
// that: drift INSIDE the same name is still the same name, and must still answer.
test('a column that drifts within its own identifier still answers', async () => {
    const path = `${FIXTURES}/Library.abide`
    const text = await Bun.file(path).text()
    const lines = text.split('\n')
    const line = lines.findIndex((one) => one.includes('title.includes(query)'))
    expect(line).toBeGreaterThan(-1)
    const live = new LiveCheck()
    try {
        const found = await live.typeAt(path, text, line, (lines[line] as string).indexOf('query') + 2)
        expect(found?.type).toBe('State<string>')
    } finally {
        live.close()
    }
}, 120_000)

test('an import goes to the file its specifier names, without asking the checker', async () => {
    const path = `${TYPES}/invalid/optional.abide`
    const text = await Bun.file(path).text()
    const live = new LiveCheck()
    const where = async (needle: string, plus: number) => {
        const offset = text.indexOf(needle) + plus
        const before = text.slice(0, offset)
        const found = await live.definitionAt(
            path,
            text,
            before.split('\n').length - 1,
            offset - (before.lastIndexOf('\n') + 1),
        )
        return found[0]?.path ?? null
    }
    try {
        // A BARE specifier, which only the real resolver can answer — a `#`-prefixed subpath import
        // is the same shape and the reason `Bun.resolveSync` is what decides this.
        expect(await where('{ state }', 3)).toMatch(/packages\/abide\/abide\.ts$/)
        // …the specifier itself, and a relative `.ts`.
        expect(await where("from 'abide'", 7)).toMatch(/packages\/abide\/abide\.ts$/)
        expect(await where('{ FIRST }', 3)).toMatch(/types\/models\.ts$/)
        // …and a `.abide`, which resolves like any other file: the extension needs a loader to be
        // IMPORTED, not to be found.
        expect(await where("'../valid/props.abide'", 3)).toMatch(/valid\/props\.abide$/)
    } finally {
        live.close()
    }
})

// `Cell` is the one public name an author READS and never writes — the sugar is the point, so a prop
// is used by name and the type behind it never had to be said out loud until a hover said it. The
// claim is that the hover connects the name back to the spelling the author already knows.
test('a hover over a cell says what a cell is, in the spelling the author uses', async () => {
    const written: Uint8Array[] = []
    const server = new LanguageServer({
        write: (message) => written.push(message),
        exit: () => {},
        typeAt: async () => ({ type: 'Cell<string>', docs: null }),
    })
    const text = '<script>\nconst className = props<{ class?: string }>()\n</script>\n<p>x</p>\n'
    server.feed(frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }))
    server.feed(
        frame({
            jsonrpc: '2.0',
            method: 'textDocument/didOpen',
            params: { textDocument: { uri: URI, version: 1, text } },
        }),
    )
    ask(server, 2, 'textDocument/hover', after(text, 'const classNa'))
    await Bun.sleep(20)
    const value = hovered(written, 2)
    // The type still leads: `className.set(…)` is a real spelling and hiding the cell would deny it.
    expect(value).toContain('Cell<string>')
    // WHY it is a cell and not a `string`, which is the question a reader actually has.
    expect(value).toContain('that can CHANGE')
    expect(value).toContain('a plain value cannot say it moved')
    // …and the spelling they use MOST — the name alone, in markup — before the one they rarely do.
    expect(value.indexOf('{className}')).toBeLessThan(value.indexOf('className.set(…)'))
    expect(value).toContain('`{className}`')
})

// A type that merely MENTIONS a cell is not one, so the note is anchored rather than searched for.
test('a type that only mentions a cell is not described as being one', async () => {
    const written: Uint8Array[] = []
    const server = new LanguageServer({
        write: (message) => written.push(message),
        exit: () => {},
        typeAt: async () => ({ type: '(value: string) => Cell<string>', docs: null }),
    })
    const text = '<script>\nconst make = 1\n</script>\n<p>x</p>\n'
    server.feed(frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }))
    server.feed(
        frame({
            jsonrpc: '2.0',
            method: 'textDocument/didOpen',
            params: { textDocument: { uri: URI, version: 1, text } },
        }),
    )
    ask(server, 2, 'textDocument/hover', after(text, 'const ma'))
    await Bun.sleep(20)
    expect(hovered(written, 2)).not.toContain('is a **cell**')
})

// --- go to definition ------------------------------------------------------
//
// Answered SYNTACTICALLY for a component and only for a component, and that is not an optimisation:
// a tag name carries no source mapping at all — only expressions do — so the checker cannot be asked
// about one however long it is given. The import in the file's own script is the whole answer.

function jumped(text: string, needle: string, plus: number): { uri: string; range: Range }[] | null {
    const written: Uint8Array[] = []
    const server = new LanguageServer({ write: (message) => written.push(message), exit: () => {} })
    server.feed(frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }))
    server.feed(
        frame({
            jsonrpc: '2.0',
            method: 'textDocument/didOpen',
            params: { textDocument: { uri: URI, version: 1, text } },
        }),
    )
    ask(server, 2, 'textDocument/definition', after(text, needle.slice(0, plus)))
    return resultOf<{ uri: string; range: Range }[] | null>(written, 2)
}

test('a component tag goes to the file its own import names', () => {
    const text = "<script module>\nimport Card from './lib/Card.abide'\n</script>\n<Card />\n"
    const found = jumped(text, '<Ca', 3)
    expect(found?.length).toBe(1)
    // `URI` is `/tmp/Probe.abide`, so the specifier resolves beside it.
    expect(found?.[0]?.uri).toBe('file:///tmp/lib/Card.abide')
})

test('a name that merely starts the same is not the binding', () => {
    // `Cardigan` binds, `Card` does not — a clause searched as a substring answers the wrong file
    // with total confidence, which is the failure this shape exists to catch.
    const text = "<script module>\nimport Cardigan from './Cardigan.abide'\n</script>\n<Card />\n"
    expect(jumped(text, '<Ca', 3)).toBeNull()
})

test('a component defined inline goes to its own {#component}', () => {
    const text = '{#component Row(n: number)}<li>{n}</li>{/component}\n<Row />\n'
    const found = jumped(text, '<Ro', 3)
    expect(found?.length).toBe(1)
    expect(found?.[0]?.uri).toBe(URI)
    // The define is on the first line, at the name rather than at the `{`.
    expect(found?.[0]?.range.start.line).toBe(0)
    expect(found?.[0]?.range.start.character).toBe(text.indexOf('Row'))
})

test('a lowercase tag is an element, so it has no definition to go to', () => {
    const text = "<script module>\nimport Card from './Card.abide'\n</script>\n<div />\n"
    expect(jumped(text, '<di', 3)).toBeNull()
})

test('the server says it can answer a definition', () => {
    const { written } = opened('<p>x</p>')
    const capabilities = resultOf<{ capabilities: Record<string, unknown> }>(written, 1).capabilities
    expect(capabilities.definitionProvider).toBe(true)
})

// --- the OTHER reader of this syntax ----------------------------------------
//
// `abide lsp` above is one half of what an editor gets; the tree-sitter grammar is the other, because
// highlighting is the part a language server does not carry. Every gate above derives its expectation
// from the compiler's own tables, which is exactly what the grammar CANNOT do: it is a separate parser
// in a separate language, generated to C and committed, so `VOID_ELEMENTS` and the block keywords are
// literal tokens in `grammar.js` restating what `parse.ts` and `VOID_ELEMENTS.ts` decide.
//
// Nothing ran `tree-sitter test`, which the grammar's own comment named as what catches the drift —
// `editors/` is not a workspace member and no script reaches it. So the drift was real and unwatched:
// a sixth block would land with `bun test` green, `abide lsp` completing it and `/docs/syntax`
// documenting it, and highlighting would silently break for everyone on the Zed extension.
//
// Read as TEXT rather than imported: `grammar.js` is CommonJS calling tree-sitter's DSL, so requiring
// it would need the `grammar`/`seq`/`choice` globals that only the generator supplies.

const GRAMMAR = await Bun.file(`${REPO_ROOT}/editors/tree-sitter-abide/grammar.js`).text()

/**
 * The `seq(…)` a rule is defined as, by balanced parens.
 *
 * Counted rather than matched to a closing `)`: a block's body spans lines and holds nested `seq`,
 * `choice` and `optional` calls, so anything reading to the first `)` stops inside the first of them.
 */
function ruleBody(rule: string): string {
    const at = GRAMMAR.indexOf(`${rule}:`)
    if (at === -1) return ''
    const opens = GRAMMAR.indexOf('(', GRAMMAR.indexOf('=>', at))
    let depth = 0
    for (let i = opens; i < GRAMMAR.length; i++) {
        const character = GRAMMAR[i]
        if (character === '(') depth++
        else if (character === ')' && --depth === 0) return GRAMMAR.slice(opens, i + 1)
    }
    return ''
}

test('the grammar and the compiler agree on which elements are void', () => {
    const declared = /const VOID_ELEMENTS = \[([\s\S]*?)\]/.exec(GRAMMAR)
    expect(declared, 'no VOID_ELEMENTS array in grammar.js').not.toBeNull()
    const spelled = [...(declared?.[1] ?? '').matchAll(/'([a-z]+)'/g)].map((found) => found[1] as string)
    // Both directions and sorted: an element the grammar forgot leaves `<img>` waiting for a closer
    // the compiler never expects, and one it invented closes a tag the compiler is still filling.
    expect(spelled.sort()).toEqual([...VOID_ELEMENTS].sort())
})

test('the grammar opens and closes exactly the blocks BRANCHES declares', () => {
    const opened = new Set([...GRAMMAR.matchAll(/'\{#',\s*'([a-z]+)'/g)].map((found) => found[1] as string))
    const closed = new Set([...GRAMMAR.matchAll(/'\{\/',\s*'([a-z]+)'/g)].map((found) => found[1] as string))
    const blocks = Object.keys(BRANCHES).sort()
    expect([...opened].sort(), 'the grammar opens a different set of blocks than BRANCHES').toEqual(blocks)
    expect([...closed].sort(), 'a block the grammar opens it cannot close').toEqual(blocks)
})

test('each block accepts exactly the branches BRANCHES gives it', () => {
    // A branch rule is wired into its block by name — `repeat($.catch_branch)` — and the keyword it
    // matches is in its own marker rule, which is where `{:catch}` is actually spelled. So the map is
    // read in two hops rather than assumed from the rule name.
    const missing: string[] = []
    for (const [block, branches] of Object.entries(BRANCHES)) {
        const body = ruleBody(`${block}_block`)
        expect(body, `no ${block}_block rule in grammar.js`).not.toBe('')
        const wired: string[] = []
        for (const found of body.matchAll(/\$\.(\w+)_branch/g)) {
            const marker = ruleBody(`${found[1] as string}_marker`)
            const keyword = /'\{:',\s*'([a-z]+)'/.exec(marker)
            if (keyword !== null) wired.push(keyword[1] as string)
        }
        const declared = Object.keys(branches).sort()
        if (JSON.stringify(wired.sort()) !== JSON.stringify(declared)) {
            missing.push(`${block}: grammar has [${wired}], BRANCHES has [${declared}]`)
        }
    }
    expect(missing, 'a block takes different branches in the grammar than in the compiler').toEqual([])
})
