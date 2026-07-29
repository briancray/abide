// Tests for `abide lsp` (C10.7, PR3) — the PERSISTENT, buffer-aware `.abide` language server.
//
// Real-process integration: spawn `node lsp.ts` (the server runs under node — the tsgo `API` can't open
// its pipe under Bun) and drive it over stdio. Asserts LIVE diagnostics — a template type error on
// `didOpen`, then CLEARED on `didChange` to a fixed buffer (no save) — proving the in-memory overlay +
// warm engine, not the disk-only stub.

import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { LSP_FEATURES } from './LSP_FEATURES.ts'

const LSP = fileURLToPath(new URL('./lsp.ts', import.meta.url))

const TSCONFIG = JSON.stringify({
    compilerOptions: {
        lib: ['ESNext', 'DOM'],
        target: 'ESNext',
        module: 'Preserve',
        moduleResolution: 'bundler',
        moduleDetection: 'force',
        allowImportingTsExtensions: true,
        noEmit: true,
        strict: true,
        skipLibCheck: true,
        types: [],
    },
    include: ['src/**/*.ts'],
})

const cleanupDirs: string[] = []
afterEach(() => {
    for (const dir of cleanupDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function frame(message: object): string {
    const body = JSON.stringify(message)
    return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
}

function parseFrames(text: string): Array<Record<string, unknown>> {
    const messages: Array<Record<string, unknown>> = []
    let cursor = 0
    while (cursor < text.length) {
        const headerEnd = text.indexOf('\r\n\r\n', cursor)
        if (headerEnd === -1) break
        const match = /Content-Length:\s*(\d+)/i.exec(text.slice(cursor, headerEnd))
        if (match === null) break
        const length = Number(match[1])
        const bodyStart = headerEnd + 4
        messages.push(JSON.parse(text.slice(bodyStart, bodyStart + length)))
        cursor = bodyStart + length
    }
    return messages
}

// Read the server's stdout INCREMENTALLY so a test can wait for the frame it actually wants instead of
// sleeping past the diagnostic debounce. A fixed sleep has to be long enough for the slowest machine
// (so it costs that on every machine) and is still a race — under `bun test --parallel` a 600ms guess
// loses to a loaded box and the publish arrives after the assertion. Waiting on the frame is both
// faster in the common case and immune to load.
function frameStream(stdout: ReadableStream<Uint8Array>) {
    const reader = stdout.getReader()
    const decoder = new TextDecoder()
    let text = ''
    let ended = false
    return {
        // Resolve once `satisfied` holds over the frames received; throw on EOF or timeout.
        async until(
            satisfied: (frames: Array<Record<string, unknown>>) => boolean,
            what: string,
            timeoutMs = 20_000,
        ): Promise<Array<Record<string, unknown>>> {
            const deadline = Date.now() + timeoutMs
            for (;;) {
                const frames = parseFrames(text)
                if (satisfied(frames)) return frames
                if (ended)
                    throw new Error(`lsp: stdout closed before ${what}\n${text.slice(0, 2000)}`)
                if (Date.now() > deadline)
                    throw new Error(`lsp: timed out waiting for ${what}\n${text.slice(0, 2000)}`)
                const { done, value } = await reader.read()
                if (done) ended = true
                else text += decoder.decode(value, { stream: true })
            }
        },
        // Drain whatever is left (the server is exiting) and return every frame.
        async rest(): Promise<Array<Record<string, unknown>>> {
            while (!ended) {
                const { done, value } = await reader.read()
                if (done) ended = true
                else text += decoder.decode(value, { stream: true })
            }
            return parseFrames(text)
        },
    }
}

const isPublish = (message: Record<string, unknown>): boolean =>
    message.method === 'textDocument/publishDiagnostics'

const diagnosticsOf = (message: Record<string, unknown> | undefined): unknown[] =>
    (message?.params as { diagnostics?: unknown[] } | undefined)?.diagnostics ?? []

test('persistent lsp: live template diagnostics on didOpen, cleared on didChange (unsaved fix)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'abide-lsp-'))
    cleanupDirs.push(root)
    writeFileSync(join(root, 'tsconfig.json'), TSCONFIG)
    const pagePath = join(root, 'src/ui/pages/p/page.abide')
    mkdirSync(dirname(pagePath), { recursive: true })
    const bad = '<script>\nconst n = 5\n</script>\n<p>{n.toUpperCase()}</p>\n' // number has no toUpperCase → TS2339 in the TEMPLATE
    writeFileSync(pagePath, bad)
    const fixed = "<script>\nconst n = 'hi'\n</script>\n<p>{n.toUpperCase()}</p>\n" // string → clean
    const uri = pathToFileURL(pagePath).href

    const proc = Bun.spawn(['node', LSP], {
        cwd: root,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
    })
    // Diagnostics are debounced (coalesced per edit), so each edit's publish is awaited rather than
    // slept past: didOpen(bad) → error publish, then didChange(fixed) → cleared publish.
    const stream = frameStream(proc.stdout)
    proc.stdin.write(
        frame({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: { rootUri: pathToFileURL(root).href },
        }) +
            frame({
                jsonrpc: '2.0',
                method: 'textDocument/didOpen',
                params: { textDocument: { uri, languageId: 'abide', version: 1, text: bad } },
            }),
    )
    await stream.until(
        (frames) => frames.some((m) => isPublish(m) && diagnosticsOf(m).length > 0),
        'the didOpen error publish',
    )
    proc.stdin.write(
        frame({
            jsonrpc: '2.0',
            method: 'textDocument/didChange',
            params: { textDocument: { uri, version: 2 }, contentChanges: [{ text: fixed }] },
        }),
    )
    await stream.until((frames) => {
        const publishes = frames.filter(isPublish)
        return publishes.length > 1 && diagnosticsOf(publishes[publishes.length - 1]).length === 0
    }, 'the didChange cleared publish')
    proc.stdin.write(frame({ jsonrpc: '2.0', method: 'exit' }))
    proc.stdin.end()
    const publishes = (await stream.rest()).filter(isPublish)
    await proc.exited

    const diagsOf = (m: Record<string, unknown> | undefined) =>
        diagnosticsOf(m) as Array<{ code: number; source: string }>

    // didOpen → the template type error is reported (mapped to the .abide, source "abide").
    const withError = publishes.find((p) => diagsOf(p).length > 0)
    expect(withError).toBeDefined()
    if (withError === undefined) throw new Error('expected a publish with diagnostics')
    expect(diagsOf(withError).some((d) => d.code === 2339 && d.source === 'abide')).toBe(true)
    expect((withError.params as { uri: string }).uri).toBe(uri)

    // didChange to the fixed (UNSAVED) buffer → diagnostics cleared (last publish is empty).
    expect(diagsOf(publishes[publishes.length - 1])).toEqual([])
}, 30_000)

test('hover returns the TS type at a template position; definition jumps template → script decl', async () => {
    const root = mkdtempSync(join(tmpdir(), 'abide-lsp-'))
    cleanupDirs.push(root)
    writeFileSync(join(root, 'tsconfig.json'), TSCONFIG)
    const pagePath = join(root, 'src/ui/pages/p/page.abide')
    mkdirSync(dirname(pagePath), { recursive: true })
    const page = '<script>\nconst count: number = 5\n</script>\n<p>{count.toFixed(2)}</p>\n' // `count` used in the TEMPLATE
    writeFileSync(pagePath, page)
    const uri = pathToFileURL(pagePath).href
    const at = { line: 3, character: 6 } // the `count` inside `{count.toFixed(2)}`

    const proc = Bun.spawn(['node', LSP], {
        cwd: root,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
    })
    proc.stdin.write(
        frame({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: { rootUri: pathToFileURL(root).href },
        }) +
            frame({
                jsonrpc: '2.0',
                method: 'textDocument/didOpen',
                params: { textDocument: { uri, languageId: 'abide', version: 1, text: page } },
            }) +
            frame({
                jsonrpc: '2.0',
                id: 2,
                method: 'textDocument/hover',
                params: { textDocument: { uri }, position: at },
            }) +
            frame({
                jsonrpc: '2.0',
                id: 3,
                method: 'textDocument/definition',
                params: { textDocument: { uri }, position: at },
            }) +
            frame({ jsonrpc: '2.0', method: 'exit' }),
    )
    proc.stdin.end()
    const out = await new Response(proc.stdout).text()
    await proc.exited
    const messages = parseFrames(out)

    // Hover: the type of `count` (a template reference) is `number`.
    const hover = messages.find((m) => m.id === 2)
    if (hover === undefined) throw new Error('expected a hover response')
    const hoverResult = hover.result as {
        contents?: { value?: string }
        range?: { start: { line: number; character: number }; end: { character: number } }
    } | null
    expect(hoverResult?.contents?.value ?? '').toContain('number')
    // A precise range covering just `count` (not the whole `{count.toFixed(2)}`) so the editor
    // highlights the hovered token — line 3, `{count...}` → `count` spans characters 4..9.
    expect(hoverResult?.range).toBeDefined()
    expect(hoverResult?.range?.start).toEqual({ line: 3, character: 4 })
    expect(hoverResult?.range?.end.character).toBe(9)

    // Definition: the template `count` resolves to its script declaration (line 1, mapped back to .abide).
    const definition = messages.find((m) => m.id === 3)
    if (definition === undefined) throw new Error('expected a definition response')
    const locations = definition.result as Array<{
        uri: string
        range: { start: { line: number } }
    }> | null
    expect(locations).not.toBeNull()
    if (locations === null) throw new Error('expected definition locations')
    const firstLocation = locations[0]
    if (firstLocation === undefined) throw new Error('expected at least one definition location')
    expect(firstLocation.uri).toBe(uri)
    expect(firstLocation.range.start.line).toBe(1)
}, 30_000)

test('completion returns member entries; signature-help resolves the call parameters', async () => {
    const root = mkdtempSync(join(tmpdir(), 'abide-lsp-'))
    cleanupDirs.push(root)
    writeFileSync(join(root, 'tsconfig.json'), TSCONFIG)
    const pagePath = join(root, 'src/ui/pages/p/page.abide')
    mkdirSync(dirname(pagePath), { recursive: true })
    const page = '<script>\nconst count: number = 5\n</script>\n<p>{count.toFixed(2)}</p>\n'
    writeFileSync(pagePath, page)
    const uri = pathToFileURL(pagePath).href

    const proc = Bun.spawn(['node', LSP], {
        cwd: root,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
    })
    proc.stdin.write(
        frame({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: { rootUri: pathToFileURL(root).href },
        }) +
            frame({
                jsonrpc: '2.0',
                method: 'textDocument/didOpen',
                params: { textDocument: { uri, languageId: 'abide', version: 1, text: page } },
            }) +
            frame({
                jsonrpc: '2.0',
                id: 4,
                method: 'textDocument/completion',
                params: { textDocument: { uri }, position: { line: 3, character: 10 } },
            }) + // after `count.`
            frame({
                jsonrpc: '2.0',
                id: 5,
                method: 'textDocument/signatureHelp',
                params: { textDocument: { uri }, position: { line: 3, character: 18 } },
            }) + // inside `toFixed(2)`
            frame({ jsonrpc: '2.0', method: 'exit' }),
    )
    proc.stdin.end()
    const messages = parseFrames(await new Response(proc.stdout).text())
    await proc.exited

    // Completion: `number` members are offered.
    const completion = messages.find((m) => m.id === 4)
    if (completion === undefined) throw new Error('expected a completion response')
    const items = (completion.result as { items?: Array<{ label: string }> } | null)?.items ?? []
    expect(items.some((i) => i.label === 'toFixed')).toBe(true)

    // Signature help: the resolved signature of `toFixed` names its parameter.
    const signatureHelp = messages.find((m) => m.id === 5)
    if (signatureHelp === undefined) throw new Error('expected a signatureHelp response')
    const label =
        (signatureHelp.result as { signatures?: Array<{ label: string }> } | null)?.signatures?.[0]
            ?.label ?? ''
    expect(label).toContain('fractionDigits')
}, 30_000)

test('find-references returns both the script declaration and the template usage', async () => {
    const root = mkdtempSync(join(tmpdir(), 'abide-lsp-'))
    cleanupDirs.push(root)
    writeFileSync(join(root, 'tsconfig.json'), TSCONFIG)
    const pagePath = join(root, 'src/ui/pages/p/page.abide')
    mkdirSync(dirname(pagePath), { recursive: true })
    const page = '<script>\nconst count: number = 5\n</script>\n<p>{count.toFixed(2)}</p>\n'
    writeFileSync(pagePath, page)
    const uri = pathToFileURL(pagePath).href

    const proc = Bun.spawn(['node', LSP], {
        cwd: root,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
    })
    proc.stdin.write(
        frame({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: { rootUri: pathToFileURL(root).href },
        }) +
            frame({
                jsonrpc: '2.0',
                method: 'textDocument/didOpen',
                params: { textDocument: { uri, languageId: 'abide', version: 1, text: page } },
            }) +
            frame({
                jsonrpc: '2.0',
                id: 6,
                method: 'textDocument/references',
                params: {
                    textDocument: { uri },
                    position: { line: 3, character: 6 },
                    context: { includeDeclaration: true },
                },
            }) +
            frame({ jsonrpc: '2.0', method: 'exit' }),
    )
    proc.stdin.end()
    const messages = parseFrames(await new Response(proc.stdout).text())
    await proc.exited

    const referencesMessage = messages.find((m) => m.id === 6)
    if (referencesMessage === undefined) throw new Error('expected a references response')
    const references = referencesMessage.result as Array<{
        uri: string
        range: { start: { line: number } }
    }>
    expect(references.every((r) => r.uri === uri)).toBe(true)
    const lines = references.map((r) => r.range.start.line).sort()
    expect(lines).toContain(1) // the `const count` declaration in the <script>
    expect(lines).toContain(3) // the `{count…}` usage in the template
}, 30_000)

test('persistent lsp: answers initialize with full-change sync + publishes clean for a valid page', async () => {
    const root = mkdtempSync(join(tmpdir(), 'abide-lsp-'))
    cleanupDirs.push(root)
    writeFileSync(join(root, 'tsconfig.json'), TSCONFIG)
    const pagePath = join(root, 'src/ui/pages/ok/page.abide')
    mkdirSync(dirname(pagePath), { recursive: true })
    const clean = "<script>\nconst greeting = 'hi'\n</script>\n<h1>{greeting.toUpperCase()}</h1>\n"
    writeFileSync(pagePath, clean)
    const uri = pathToFileURL(pagePath).href

    const proc = Bun.spawn(['node', LSP], {
        cwd: root,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
    })
    // Diagnostics are debounced, so the clean publish is awaited before exiting rather than slept past.
    const stream = frameStream(proc.stdout)
    proc.stdin.write(
        frame({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: { rootUri: pathToFileURL(root).href },
        }) +
            frame({
                jsonrpc: '2.0',
                method: 'textDocument/didOpen',
                params: { textDocument: { uri, languageId: 'abide', version: 1, text: clean } },
            }),
    )
    await stream.until(
        (frames) => frames.some((m) => m.id === 1) && frames.some(isPublish),
        'the initialize response + clean publish',
    )
    proc.stdin.write(frame({ jsonrpc: '2.0', method: 'exit' }))
    proc.stdin.end()
    const messages = await stream.rest()
    await proc.exited
    const init = messages.find((m) => m.id === 1)
    if (init === undefined) throw new Error('expected an initialize response')
    expect(
        (init.result as { capabilities?: { textDocumentSync?: { change?: number } } }).capabilities
            ?.textDocumentSync?.change,
    ).toBe(1)
    const publish = messages.find((m) => m.method === 'textDocument/publishDiagnostics')
    if (publish === undefined) throw new Error('expected a publishDiagnostics message')
    expect((publish.params as { diagnostics: unknown[] }).diagnostics).toEqual([])
}, 30_000)

// Regression: a symbol imported from ANOTHER file (a `$server/rpc/*`-style module) must hover to its
// real type, and must STAY resolved after a `didChange`. The warm tsgo API's incremental snapshot used
// to collapse cross-file import resolution to `any` on every snapshot after the first — so the very
// first hover looked fine but every hover after an edit went `any`. The engine now rebuilds the API when
// the overlay changes; this asserts the type survives the edit.
test('cross-file import hovers to its real type and stays resolved after didChange', async () => {
    const root = mkdtempSync(join(tmpdir(), 'abide-lsp-'))
    cleanupDirs.push(root)
    writeFileSync(
        join(root, 'tsconfig.json'),
        JSON.stringify({
            compilerOptions: {
                lib: ['ESNext', 'DOM'],
                target: 'ESNext',
                module: 'Preserve',
                moduleResolution: 'bundler',
                moduleDetection: 'force',
                allowImportingTsExtensions: true,
                noEmit: true,
                strict: true,
                skipLibCheck: true,
                types: [],
                paths: { '$server/*': ['./src/server/*'] },
            },
            include: ['src/**/*.ts'],
        }),
    )
    // A cross-file module the page imports (stands in for a `$server/rpc/*` RPC — a plain typed export,
    // so the test stays hermetic without the real `abide` runtime).
    const widgetPath = join(root, 'src/server/rpc/widget.ts')
    mkdirSync(dirname(widgetPath), { recursive: true })
    writeFileSync(
        widgetPath,
        'export interface Widget {\n  label: string\n  count: number\n}\nexport default function widget(): Widget {\n  return { label: "x", count: 1 }\n}\n',
    )
    const pagePath = join(root, 'src/ui/pages/p/page.abide')
    mkdirSync(dirname(pagePath), { recursive: true })
    const page =
        '<script module>\nimport widget from "$server/rpc/widget"\nconst w = widget()\n</script>\n<p>{w.label}</p>\n'
    const edited = page.replace('<p>{w.label}</p>', '<p>{w.label}!</p>') // a trivial template edit → didChange
    const uri = pathToFileURL(pagePath).href
    writeFileSync(pagePath, page)
    const at = { line: 4, character: 4 } // the `w` inside `{w.label}` — its type flows from widget.ts

    const proc = Bun.spawn(['node', LSP], {
        cwd: root,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
    })
    proc.stdin.write(
        frame({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: { rootUri: pathToFileURL(root).href },
        }) +
            frame({
                jsonrpc: '2.0',
                method: 'textDocument/didOpen',
                params: { textDocument: { uri, languageId: 'abide', version: 1, text: page } },
            }) +
            frame({
                jsonrpc: '2.0',
                id: 2,
                method: 'textDocument/hover',
                params: { textDocument: { uri }, position: at },
            }) +
            // an edit, then hover again — the path that used to regress to `any`
            frame({
                jsonrpc: '2.0',
                method: 'textDocument/didChange',
                params: { textDocument: { uri, version: 2 }, contentChanges: [{ text: edited }] },
            }) +
            frame({
                jsonrpc: '2.0',
                id: 3,
                method: 'textDocument/hover',
                params: { textDocument: { uri }, position: at },
            }) +
            // Go-to-definition on the imported `widget` (line 2 `const w = widget()`) must jump THROUGH
            // the import to the source file, not land on the local `import …` line.
            frame({
                jsonrpc: '2.0',
                id: 4,
                method: 'textDocument/definition',
                params: { textDocument: { uri }, position: { line: 2, character: 12 } },
            }) +
            frame({ jsonrpc: '2.0', method: 'exit' }),
    )
    proc.stdin.end()
    const out = await new Response(proc.stdout).text()
    await proc.exited
    const messages = parseFrames(out)
    const hoverValue = (id: number): string =>
        (messages.find((m) => m.id === id)?.result as { contents?: { value?: string } } | null)
            ?.contents?.value ?? ''

    // Both hovers resolve `w` to the imported `Widget` — never `any`.
    expect(hoverValue(2)).toContain('Widget')
    expect(hoverValue(3)).toContain('Widget') // the post-didChange hover — the regression guard
    expect(hoverValue(3)).not.toContain('any')

    // Definition follows the import alias into `widget.ts` (the `export default function widget`), not
    // the `.abide` import line.
    const definition = messages.find((m) => m.id === 4)
    const target = (
        definition?.result as Array<{ uri: string; range: { start: { line: number } } }>
    )?.[0]
    // Case-insensitive compare: tsgo canonicalizes the path to lowercase on a case-insensitive FS.
    expect(target?.uri.toLowerCase()).toBe(pathToFileURL(widgetPath).href.toLowerCase())
    expect(target?.range.start.line).toBe(4) // `export default function widget(): Widget {`
}, 30_000)

// CAPABILITY↔HANDLER PARITY. The advertised capabilities and the implemented methods were two lists
// related by convention, and both failure modes are silent in opposite directions: a handler with no
// capability is dead code the editor never calls, and a capability with no handler makes the editor
// send a request that is never answered — which an LSP client with no timeout waits on forever.
//
// `capabilities` is now derived from `LSP_FEATURES`, so the first direction is structural. This asserts
// the second against the REAL server: every method the table names must answer, and the reply must
// carry the request id (a response, not a stray notification).
test('every advertised capability has a handler that answers', async () => {
    const root = mkdtempSync(join(tmpdir(), 'abide-lsp-'))
    cleanupDirs.push(root)
    writeFileSync(join(root, 'tsconfig.json'), TSCONFIG)
    const pagePath = join(root, 'src/ui/pages/p/page.abide')
    mkdirSync(dirname(pagePath), { recursive: true })
    const source = "<script>\nconst greeting = 'hi'\n</script>\n<p>{greeting}</p>\n"
    writeFileSync(pagePath, source)
    const uri = pathToFileURL(pagePath).href

    const proc = Bun.spawn(['node', LSP], {
        cwd: root,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const methods = Object.keys(LSP_FEATURES)
    // A position inside `{greeting}` on the template line, so every feature has something to answer
    // about rather than answering null because the cursor sits in whitespace.
    const position = { line: 3, character: 4 }
    let input =
        frame({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: { rootUri: pathToFileURL(root).href },
        }) +
        frame({
            jsonrpc: '2.0',
            method: 'textDocument/didOpen',
            params: {
                textDocument: { uri, languageId: 'abide', version: 1, text: source },
            },
        })
    for (const [index, method] of methods.entries()) {
        input += frame({
            jsonrpc: '2.0',
            id: 100 + index,
            method,
            // `references` wants a context; the others ignore the extra field.
            params: {
                textDocument: { uri },
                position,
                context: { includeDeclaration: true },
            },
        })
    }
    input += frame({ jsonrpc: '2.0', method: 'exit' })

    proc.stdin.write(input)
    proc.stdin.end()
    const messages = parseFrames(await new Response(proc.stdout).text())
    await proc.exited

    // The initialize reply advertises exactly the table's capabilities (plus the lifecycle sync).
    const init = messages.find((m) => m.id === 1)
    const capabilities = (init?.result as { capabilities?: Record<string, unknown> } | undefined)
        ?.capabilities
    if (capabilities === undefined) throw new Error('expected an initialize response')
    for (const feature of Object.values(LSP_FEATURES)) {
        expect(capabilities[feature.capability]).toBeDefined()
    }

    // …and every one of them answers.
    const unanswered = methods.filter(
        (_method, index) => messages.find((m) => m.id === 100 + index) === undefined,
    )
    expect(unanswered).toEqual([])
}, 60_000)
