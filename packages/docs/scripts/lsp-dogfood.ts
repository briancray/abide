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
const LSP = fileURLToPath(new URL('../../abide/src/lib/cli/lsp.ts', import.meta.url))

// Real, script-bearing, check-clean pages (cross-file component + RPC usage).
const CLEAN_PAGES = [
    'src/ui/pages/rpc/page.abide',
    'src/ui/pages/machines/page.abide',
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

const input =
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
    ).join('') +
    // Break the first page's UNSAVED buffer — its last publish must now carry the error.
    frame({
        jsonrpc: '2.0',
        method: 'textDocument/didChange',
        params: {
            textDocument: { uri: pathToFileURL(EDITED_PAGE).href, version: 2 },
            contentChanges: [{ text: BAD_BUFFER }],
        },
    }) +
    frame({ jsonrpc: '2.0', method: 'exit' })

const proc = Bun.spawn(['node', LSP], { cwd: DOCS, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
proc.stdin.write(input)
proc.stdin.end()
const out = await new Response(proc.stdout).text()
await proc.exited

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
const editedUri = pathToFileURL(EDITED_PAGE).href
const editedDiagnostics = lastByUri.get(editedUri) ?? []
if (!editedDiagnostics.some((d) => d.code === 2339))
    fail(
        `edited buffer did not report the expected TS2339 (got ${JSON.stringify(editedDiagnostics)})`,
    )

console.info(
    `abide lsp dogfood — OK: ${CLEAN_PAGES.length - 1} real pages clean, live edit surfaced TS2339`,
)
