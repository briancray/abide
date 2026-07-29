// LSP dogfood — drives `abide lsp` against the REAL docs app (the parallel of `abide-check`, but
// through the language-server path). Asserts two things the synthetic fixtures can't:
//   (1) a set of real, check-clean pages (cross-file `<Sample>` usage + RPC imports) report ZERO
//       diagnostics — the persistent engine + `fs` overlay + cross-file resolution work at real scale;
//   (2) a `didChange` to a known-bad UNSAVED buffer reports the error — live in-memory checking runs.
// Exits non-zero (with a message) on any mismatch so it can gate CI.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const DOCS = fileURLToPath(new URL('..', import.meta.url))
const LSP = fileURLToPath(new URL('../../abide/src/cli/lsp.ts', import.meta.url))

// Real, script-bearing, check-clean pages (cross-file component + RPC usage).
const CLEAN_PAGES = [
    'src/ui/pages/rpc/page.abide',
    'src/ui/pages/platform/machines/page.abide',
    'src/ui/pages/platform/config/page.abide',
].map((p) => join(DOCS, p))
const EDITED_PAGE = CLEAN_PAGES[0] ?? ''
const BAD_BUFFER = '<script>\nconst n = 5\n</script>\n<p>{n.toUpperCase()}</p>\n' // number has no toUpperCase → TS2339

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

function fail(message: string): never {
    console.error(`abide lsp dogfood — FAIL: ${message}`)
    process.exit(1)
}

// Diagnostics are DEBOUNCED, and `exit` clears the pending timer — so the frames cannot all be written
// in one burst with `exit` on the end. That is what this script used to do, and the server (correctly)
// shut down before the debounce fired, so nothing was ever published and the failure read as "the LSP
// produced no diagnostics" rather than "we never waited for them". Write, read until the publishes we
// need have arrived, then write the next thing.
const proc = Bun.spawn(['node', LSP], { cwd: DOCS, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })

const reader = proc.stdout.getReader()
const decoder = new TextDecoder()
let seen = ''
const received: Array<Record<string, unknown>> = []

// Read until `done(received)` is satisfied, or the stream ends.
async function readUntil(done: () => boolean, what: string): Promise<void> {
    while (!done()) {
        const chunk = await reader.read()
        if (chunk.done) fail(`the server closed while waiting for ${what}`)
        seen += decoder.decode(chunk.value, { stream: true })
        received.length = 0
        received.push(...parseFrames(seen))
    }
}

const publishedFor = (page: string): Record<string, unknown> | undefined =>
    received.findLast(
        (m) =>
            m.method === 'textDocument/publishDiagnostics' &&
            (m.params as { uri?: string }).uri === pathToFileURL(page).href,
    )

proc.stdin.write(
    frame({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { rootUri: pathToFileURL(DOCS).href },
    }) +
        CLEAN_PAGES.map((page) =>
            frame({
                jsonrpc: '2.0',
                method: 'textDocument/didOpen',
                params: {
                    textDocument: {
                        uri: pathToFileURL(page).href,
                        languageId: 'abide',
                        version: 1,
                        text: readFileSync(page, 'utf8'),
                    },
                },
            }),
        ).join(''),
)
await readUntil(
    () => CLEAN_PAGES.every((page) => publishedFor(page) !== undefined),
    'the didOpen diagnostics',
)

// Break the first page's UNSAVED buffer — its next publish must now carry the error.
const editedUri = pathToFileURL(EDITED_PAGE).href
const beforeEdit = received.filter((m) => m.method === 'textDocument/publishDiagnostics').length
proc.stdin.write(
    frame({
        jsonrpc: '2.0',
        method: 'textDocument/didChange',
        params: {
            textDocument: { uri: editedUri, version: 2 },
            contentChanges: [{ text: BAD_BUFFER }],
        },
    }),
)
await readUntil(
    () =>
        received.filter((m) => m.method === 'textDocument/publishDiagnostics').length > beforeEdit &&
        (publishedFor(EDITED_PAGE)?.params as { diagnostics?: unknown[] })?.diagnostics?.length !==
            0,
    'the didChange diagnostics',
)

proc.stdin.write(frame({ jsonrpc: '2.0', method: 'exit' }))
proc.stdin.end()
reader.releaseLock()
await proc.exited

const out = seen
const publishes = parseFrames(out).filter((m) => m.method === 'textDocument/publishDiagnostics')
// Last publish per uri wins (didChange supersedes didOpen for the edited page).
const lastByUri = new Map<string, Array<{ code: number }>>()
for (const p of publishes) {
    const params = p.params as { uri: string; diagnostics: Array<{ code: number }> }
    lastByUri.set(params.uri, params.diagnostics)
}

// (1) The two UNEDITED clean pages must be diagnostic-free.
for (const page of CLEAN_PAGES.slice(1)) {
    const uri = pathToFileURL(page).href
    const diagnostics = lastByUri.get(uri)
    if (diagnostics === undefined) fail(`no diagnostics published for clean page ${page}`)
    if (diagnostics.length !== 0)
        fail(
            `clean page ${page} reported ${diagnostics.length} diagnostic(s): ${JSON.stringify(diagnostics)}`,
        )
}

// (2) The edited page's unsaved buffer must surface the TS2339.
const editedDiagnostics = lastByUri.get(editedUri) ?? []
if (!editedDiagnostics.some((d) => d.code === 2339))
    fail(
        `edited buffer did not report the expected TS2339 (got ${JSON.stringify(editedDiagnostics)})`,
    )

console.info(
    `abide lsp dogfood — OK: ${CLEAN_PAGES.length - 1} real pages clean, live edit surfaced TS2339`,
)
