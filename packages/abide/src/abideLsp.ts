import ts from 'typescript'
import { ABIDE_SEMANTIC_TOKENS_LEGEND } from './lib/ui/compile/ABIDE_SEMANTIC_TOKENS_LEGEND.ts'
import type {
    ShadowLanguageService,
    ShadowQuickInfo,
} from './lib/ui/compile/createShadowLanguageService.ts'
import { createShadowLanguageService } from './lib/ui/compile/createShadowLanguageService.ts'
import { encodeSemanticTokens } from './lib/ui/compile/encodeSemanticTokens.ts'
import { nearestProjectRoot } from './lib/ui/compile/nearestProjectRoot.ts'
import { offsetToPosition } from './lib/ui/compile/offsetToPosition.ts'
import { templateSemanticTokens } from './lib/ui/compile/templateSemanticTokens.ts'
import type { AbideDiagnostic } from './lib/ui/compile/types/AbideDiagnostic.ts'

/*
A minimal Language Server for `.abide` files over stdio (JSON-RPC with
Content-Length framing). It publishes type-check diagnostics — the shadow's
errors mapped onto the component source — on open/change/save, and answers hover
requests with TypeScript's quick-info for the expression under the cursor, so an
editor shows squiggles and signature popovers on template expressions and child
props. Full-document sync keeps the loop tiny; the shadow LanguageService holds
unsaved text as overlays. Each document routes to a shadow service for its
nearest tsconfig, so files in a monorepo opened at its root are checked against
their own project — matching `abide check` run from that package.
*/
/*
The semantic-tokens `data` array for one component: the HTML markup structure and
the structural `{#…}` framing — both driven by the ONE parse walk
(`templateSemanticTokens`) — merged with the shadow's type-aware expression tokens,
encoded to the LSP wire format. The markup tokens make the LSP own the
element/attribute coloring too, so a tree-sitter parse desynced by an `attr={expr}`
value can't bleed miscoloring below it. Never throws — on any internal failure it
yields an empty stream so the editor falls back to tree-sitter highlighting.
*/
export function componentSemanticTokens(
    service: ShadowLanguageService,
    abidePath: string,
    text: string,
): number[] {
    try {
        const tokens = [
            ...templateSemanticTokens(text),
            ...service.semanticClassifications(abidePath),
        ]
        return encodeSemanticTokens(text, tokens)
    } catch {
        return []
    }
}

export async function abideLsp({ cwd }: { cwd: string }): Promise<void> {
    const documentText = new Map<string, string>()

    /* A shadow service per project root, created on first use. A document's
       diagnostics/hover come from the service for its nearest tsconfig. */
    const services = new Map<string, ShadowLanguageService>()
    const serviceFor = (path: string): ShadowLanguageService => {
        const root = nearestProjectRoot(path, cwd)
        const existing = services.get(root)
        if (existing !== undefined) {
            return existing
        }
        const created = createShadowLanguageService(root)
        services.set(root, created)
        return created
    }

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
                uri: Bun.pathToFileURL(path).href,
                diagnostics: serviceFor(path)
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
                        capabilities: {
                            textDocumentSync: 1,
                            hoverProvider: true,
                            semanticTokensProvider: {
                                legend: ABIDE_SEMANTIC_TOKENS_LEGEND,
                                full: true,
                            },
                        },
                        serverInfo: { name: 'abide-lsp' },
                    },
                })
                return
            case 'textDocument/didOpen': {
                const { uri, text } = message.params.textDocument
                if (isAbide(uri)) {
                    const path = Bun.fileURLToPath(uri)
                    documentText.set(path, text)
                    serviceFor(path).update(path, text)
                    publish(path)
                }
                return
            }
            case 'textDocument/didChange': {
                const { uri } = message.params.textDocument
                if (isAbide(uri)) {
                    const path = Bun.fileURLToPath(uri)
                    const text = message.params.contentChanges.at(-1)?.text ?? ''
                    documentText.set(path, text)
                    serviceFor(path).update(path, text)
                    publish(path)
                }
                return
            }
            case 'textDocument/didSave': {
                const { uri } = message.params.textDocument
                if (isAbide(uri)) {
                    publish(Bun.fileURLToPath(uri))
                }
                return
            }
            case 'textDocument/hover': {
                /* A request: always answer (null when there's nothing to show) so
                   the editor isn't left waiting. */
                const { uri } = message.params.textDocument
                const text = isAbide(uri) ? (documentText.get(Bun.fileURLToPath(uri)) ?? '') : ''
                const info = isAbide(uri)
                    ? serviceFor(Bun.fileURLToPath(uri)).quickInfo(
                          Bun.fileURLToPath(uri),
                          positionToOffset(text, message.params.position),
                      )
                    : undefined
                send({
                    jsonrpc: '2.0',
                    id: message.id,
                    result: info === undefined ? null : toLspHover(text, info),
                })
                return
            }
            case 'textDocument/semanticTokens/full': {
                const { uri } = message.params.textDocument
                const data = isAbide(uri)
                    ? componentSemanticTokens(
                          serviceFor(Bun.fileURLToPath(uri)),
                          Bun.fileURLToPath(uri),
                          documentText.get(Bun.fileURLToPath(uri)) ?? '',
                      )
                    : []
                send({ jsonrpc: '2.0', id: message.id, result: { data } })
                return
            }
            case 'textDocument/didClose': {
                const { uri } = message.params.textDocument
                if (isAbide(uri)) {
                    const path = Bun.fileURLToPath(uri)
                    serviceFor(path).close(path)
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

/* Renders mapped quick-info as an LSP hover: TypeScript's signature in a fenced
   `ts` block, the doc comment (if any) below, over the covered source range. */
function toLspHover(text: string, info: ShadowQuickInfo): object {
    const fence = ['```ts', info.text, '```'].join('\n')
    const value = info.documentation.length > 0 ? `${fence}\n\n${info.documentation}` : fence
    return {
        contents: { kind: 'markdown', value },
        range: {
            start: offsetToPosition(text, info.start),
            end: offsetToPosition(text, info.start + info.length),
        },
    }
}

/* An LSP `{ line, character }` (0-based) → absolute offset in `text`. */
function positionToOffset(text: string, position: { line: number; character: number }): number {
    const lineStart = text
        .split('\n')
        .slice(0, position.line)
        .reduce((sum, line) => sum + line.length + 1, 0)
    return lineStart + position.character
}
