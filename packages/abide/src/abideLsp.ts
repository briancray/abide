import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import { createShadowLanguageService } from './lib/ui/compile/createShadowLanguageService.ts'
import type { AbideDiagnostic } from './lib/ui/compile/types/AbideDiagnostic.ts'

/*
A minimal Language Server for `.abide` files over stdio (JSON-RPC with
Content-Length framing). It publishes type-check diagnostics — the shadow's
errors mapped onto the component source — on open/change/save, so an editor shows
squiggles on bad template expressions and child props. Full-document sync keeps
the loop tiny; the shadow LanguageService holds unsaved text as overlays.
*/
export async function abideLsp({ cwd }: { cwd: string }): Promise<void> {
    const service = createShadowLanguageService(cwd)
    const documentText = new Map<string, string>()

    const send = (message: object): void => {
        const body = JSON.stringify(message)
        process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
    }

    const publish = (path: string): void => {
        const text = documentText.get(path) ?? ''
        send({
            jsonrpc: '2.0',
            method: 'textDocument/publishDiagnostics',
            params: {
                uri: pathToFileURL(path).href,
                diagnostics: service
                    .diagnostics(path)
                    .map((diagnostic) => toLspDiagnostic(text, diagnostic)),
            },
        })
    }

    const isAbide = (uri: string): boolean => uri.endsWith('.abide')

    const handle = (message: LspMessage): void => {
        switch (message.method) {
            case 'initialize':
                send({
                    jsonrpc: '2.0',
                    id: message.id,
                    result: {
                        capabilities: { textDocumentSync: 1 },
                        serverInfo: { name: 'abide-lsp' },
                    },
                })
                return
            case 'textDocument/didOpen': {
                const { uri, text } = message.params.textDocument
                if (isAbide(uri)) {
                    const path = fileURLToPath(uri)
                    documentText.set(path, text)
                    service.update(path, text)
                    publish(path)
                }
                return
            }
            case 'textDocument/didChange': {
                const { uri } = message.params.textDocument
                if (isAbide(uri)) {
                    const path = fileURLToPath(uri)
                    const text = message.params.contentChanges.at(-1)?.text ?? ''
                    documentText.set(path, text)
                    service.update(path, text)
                    publish(path)
                }
                return
            }
            case 'textDocument/didSave': {
                const { uri } = message.params.textDocument
                if (isAbide(uri)) {
                    publish(fileURLToPath(uri))
                }
                return
            }
            case 'textDocument/didClose': {
                const { uri } = message.params.textDocument
                if (isAbide(uri)) {
                    const path = fileURLToPath(uri)
                    service.close(path)
                    documentText.delete(path)
                    send({
                        jsonrpc: '2.0',
                        method: 'textDocument/publishDiagnostics',
                        params: { uri, diagnostics: [] },
                    })
                }
                return
            }
            case 'shutdown':
                send({ jsonrpc: '2.0', id: message.id, result: null })
                return
            case 'exit':
                process.exit(0)
        }
    }

    /* Pull complete `Content-Length`-framed messages out of the byte stream. */
    let buffer = Buffer.alloc(0)
    for await (const chunk of process.stdin) {
        buffer = Buffer.concat([buffer, chunk as Buffer])
        while (true) {
            const headerEnd = buffer.indexOf('\r\n\r\n')
            if (headerEnd === -1) {
                break
            }
            const header = buffer.toString('utf8', 0, headerEnd)
            const length = Number(header.match(/Content-Length: (\d+)/i)?.[1])
            const bodyStart = headerEnd + 4
            if (!Number.isFinite(length) || buffer.length < bodyStart + length) {
                break
            }
            const body = buffer.toString('utf8', bodyStart, bodyStart + length)
            buffer = buffer.subarray(bodyStart + length)
            handle(JSON.parse(body))
        }
    }
}

/* The LSP requests this server reads; loosely typed since it only branches on
   `method` and reads a few known fields. */
type LspMessage = {
    id?: number | string
    method: string
    params?: any
}

/* Converts a mapped abide diagnostic to an LSP diagnostic over the document text. */
function toLspDiagnostic(text: string, diagnostic: AbideDiagnostic): object {
    return {
        range: {
            start: offsetToPosition(text, diagnostic.start),
            end: offsetToPosition(text, diagnostic.start + diagnostic.length),
        },
        severity: diagnostic.category === ts.DiagnosticCategory.Error ? 1 : 2,
        source: 'abide',
        message: diagnostic.message,
    }
}

/* An absolute offset → LSP `{ line, character }` (0-based, UTF-16 code units). */
function offsetToPosition(text: string, offset: number): { line: number; character: number } {
    const before = text.slice(0, offset)
    const line = before.split('\n').length - 1
    return { line, character: offset - (before.lastIndexOf('\n') + 1) }
}
