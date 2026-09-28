import { type FSWatcher, watch } from 'node:fs' // bun exposes no file watcher of its own
import { basename, dirname } from 'node:path' // bun exposes no path helpers of its own
import { checkSource } from './checkApp.ts'
import { type AppChecker, openChecker } from './compileApp.ts'
import type { Diagnosis, Inspection, Place } from './TypeSession.ts'

// 38.12 — `abide lsp`: THE `.abide` LANGUAGE SERVER, OVER STDIO. It is `abide check` (38.3) asked
// about one open document at a time, so the squiggle an editor draws and the line CI fails on are
// one finding rather than two implementations that agree most of the time.
//
// WHAT IT SPEAKS is the part of the protocol a diagnostic needs: the handshake, a document opened,
// changed and closed, and `publishDiagnostics` back. The document is synced whole (`Full`), so what
// is checked is exactly the editor's text, saved or not. A hover and a jump to a definition are
// asked of the program that check registered (`TypeSession.inspect`), so they answer about the
// same text.
//
// THE APP IS THE DOCUMENT'S. An editor starts this at the root of whatever it has open, which in a
// monorepo is not an app at all, so each document is checked against the nearest directory above
// it holding the `ui/` it sits in (`appRootOf`) — with one checker per app, kept for the session.
// `--root` pins every document to one.
//
// ONE CHECK AT A TIME. The checker holds one snapshot, and two checks interleaving would each
// register the other's text for a moment; a burst of keystrokes collapses onto the last one.

type Message = {
    id?: number | string
    method?: string
    params?: unknown
}

type Document = { uri: string; text: string; version: number }

const SETTLE_MS = 150
const HEADER_END = '\r\n\r\n'
const ENCODER = new TextEncoder()

// The protocol's `DiagnosticSeverity`.
const SEVERITY: Record<Diagnosis['category'], number> = {
    error: 1,
    warning: 2,
    message: 3,
    suggestion: 4,
}

export async function serveLanguage(
    root: string | undefined,
    input: ReadableStream<Uint8Array>,
    write: (bytes: Uint8Array) => void,
): Promise<void> {
    const documents = new Map<string, Document>()
    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    const checkers = new Map<string, AppChecker>()
    const watchers = new Map<string, FSWatcher>()
    let queue: Promise<void> = Promise.resolve()

    const send = (message: object): void => {
        const body = ENCODER.encode(
            JSON.stringify({ jsonrpc: '2.0', ...message }),
        )
        write(ENCODER.encode(`Content-Length: ${body.length}${HEADER_END}`))
        write(body)
    }

    const publish = (uri: string, found: Diagnosis[], text: string): void => {
        const diagnostics: object[] = []
        const lines = text.split('\n')
        for (const diagnosis of found) {
            const line = Math.max(diagnosis.line - 1, 0)
            const character = Math.max(diagnosis.column - 1, 0)
            diagnostics.push({
                range: {
                    start: { line, character },
                    end: {
                        line,
                        character:
                            character +
                            wordLength(lines[line] ?? '', character),
                    },
                },
                severity: SEVERITY[diagnosis.category],
                source: 'abide',
                ...(diagnosis.code === 0 ? {} : { code: diagnosis.code }),
                message: diagnosis.message,
            })
        }
        send({
            method: 'textDocument/publishDiagnostics',
            params: { uri, diagnostics },
        })
    }

    // An app's checker, opened on first use and kept for the session — and TOLD WHAT MOVED ON DISK,
    // or it answers every check from the text it read when it opened: an export added to a `.ts`
    // beside the page is "no exported member" until the editor restarts this. A project whose
    // tsconfig or package.json moved is opened again.
    const checkerOf = async (app: string): Promise<AppChecker> => {
        let checker = checkers.get(app)
        if (checker !== undefined && !checker.current()) {
            checkers.delete(app)
            await checker.close().catch(() => {})
            checker = undefined
        }
        if (checker === undefined) {
            checker = await openChecker(app)
            checkers.set(app, checker)
        }
        if (!watchers.has(app))
            watchers.set(
                app,
                watch(app, { recursive: true }, (_event, filename) => {
                    checkers
                        .get(app)
                        ?.saw(
                            filename === null
                                ? undefined
                                : `${app}/${filename}`,
                        )
                    // What an open page says may be decided by the file that moved.
                    for (const uri of documents.keys())
                        if ((root ?? appRootOf(Bun.fileURLToPath(uri))) === app)
                            check(uri)
                }),
            )
        return checker
    }

    const run = async (uri: string): Promise<void> => {
        const document = documents.get(uri)
        if (document === undefined) return
        const version = document.version
        const path = Bun.fileURLToPath(uri)
        const app = root ?? appRootOf(path)
        // A `.abide` belonging to no app has nothing to be checked against.
        if (app === undefined) return
        let found: Diagnosis[]
        try {
            found = await checkSource(
                await checkerOf(app),
                app,
                path,
                document.text,
                (held) => documents.get(Bun.pathToFileURL(held).href)?.text,
            )
        } catch (thrown) {
            // The checker's own failure, not the page's: the next check opens another.
            const failed = checkers.get(app)
            checkers.delete(app)
            await failed?.close().catch(() => {})
            found = [
                {
                    path,
                    line: 1,
                    column: 1,
                    code: 0,
                    category: 'error',
                    message:
                        thrown instanceof Error
                            ? thrown.message
                            : String(thrown),
                },
            ]
        }
        // A newer text has arrived while this one was checked, and will be published.
        if (documents.get(uri)?.version !== version) return
        publish(uri, found, document.text)
    }

    const check = (uri: string): void => {
        clearTimeout(timers.get(uri))
        timers.set(
            uri,
            setTimeout(() => {
                timers.delete(uri)
                queue = queue.then(() => run(uri))
            }, SETTLE_MS),
        )
    }

    // A question about a document is about the text the editor shows, so a check still settling
    // runs now rather than after the answer; and it is answered in the queue, after that check.
    const inspect = (params: unknown): Promise<Inspection | undefined> => {
        const { textDocument, position } = params as {
            textDocument: { uri: string }
            position: { line: number; character: number }
        }
        const uri = textDocument.uri
        if (timers.has(uri)) {
            clearTimeout(timers.get(uri))
            timers.delete(uri)
            queue = queue.then(() => run(uri))
        }
        const answered = queue.then(async () => {
            const document = documents.get(uri)
            if (document === undefined) return undefined
            const path = Bun.fileURLToPath(uri)
            const app = root ?? appRootOf(path)
            if (app === undefined) return undefined
            return (await checkerOf(app)).session.inspect(
                path,
                document.text,
                offsetOf(document.text, position),
            )
        })
        queue = answered.then(
            () => {},
            () => {},
        )
        return answered.catch(() => undefined)
    }

    const handle = async (message: Message): Promise<boolean> => {
        const params = message.params as Record<string, unknown> | undefined
        switch (message.method) {
            case 'initialize':
                send({
                    id: message.id,
                    result: {
                        capabilities: {
                            textDocumentSync: 1,
                            hoverProvider: true,
                            definitionProvider: true,
                        },
                        serverInfo: { name: 'abide' },
                    },
                })
                return true
            case 'shutdown':
                await queue
                send({ id: message.id, result: null })
                return true
            case 'exit':
                return false
            case 'textDocument/didOpen': {
                const opened = params?.textDocument as Document
                // A document with no file behind it — `untitled:` — belongs to no app, and has no
                // path for one to be found from.
                if (
                    !opened.uri.startsWith('file:') ||
                    !opened.uri.endsWith('.abide')
                )
                    return true
                documents.set(opened.uri, {
                    uri: opened.uri,
                    text: opened.text,
                    version: opened.version,
                })
                check(opened.uri)
                return true
            }
            case 'textDocument/didChange': {
                const changed = params?.textDocument as Document
                const document = documents.get(changed.uri)
                const changes = params?.contentChanges as { text: string }[]
                const last = changes[changes.length - 1]
                if (document === undefined || last === undefined) return true
                document.text = last.text
                document.version = changed.version
                check(changed.uri)
                return true
            }
            case 'textDocument/hover': {
                const found = await inspect(params)
                send({
                    id: message.id,
                    result:
                        found === undefined
                            ? null
                            : {
                                  contents: {
                                      kind: 'markdown',
                                      value: `\`\`\`ts\n${found.signature}\n\`\`\`${
                                          found.documentation === ''
                                              ? ''
                                              : `\n\n${found.documentation}`
                                      }`,
                                  },
                              },
                })
                return true
            }
            case 'textDocument/definition': {
                const found = await inspect(params)
                const locations: object[] = []
                for (const place of found?.definitions ?? [])
                    locations.push(locationOf(place))
                send({ id: message.id, result: locations })
                return true
            }
            case 'textDocument/didClose': {
                const closed = params?.textDocument as { uri: string }
                if (!documents.delete(closed.uri)) return true
                clearTimeout(timers.get(closed.uri))
                timers.delete(closed.uri)
                publish(closed.uri, [], '')
                return true
            }
        }
        // A request this server does not answer is still answered, so the client does not wait.
        if (message.id !== undefined && message.method !== undefined)
            send({
                id: message.id,
                error: {
                    code: -32601,
                    message: `${message.method} is not served`,
                },
            })
        return true
    }

    let buffer = new Uint8Array(0)
    const decoder = new TextDecoder()
    for await (const chunk of input) {
        const joined = new Uint8Array(buffer.length + chunk.length)
        joined.set(buffer)
        joined.set(chunk, buffer.length)
        buffer = joined
        for (;;) {
            const header = decoder.decode(buffer.subarray(0, 256))
            const end = header.indexOf(HEADER_END)
            if (end === -1) break
            const length = Number(/Content-Length: (\d+)/i.exec(header)?.[1])
            const start = end + HEADER_END.length
            if (buffer.length < start + length) break
            const message = JSON.parse(
                decoder.decode(buffer.subarray(start, start + length)),
            ) as Message
            buffer = buffer.slice(start + length)
            if (!(await handle(message))) {
                await closeAll(checkers, watchers)
                return
            }
        }
    }
    await closeAll(checkers, watchers)
}

async function closeAll(
    checkers: Map<string, AppChecker>,
    watchers: Map<string, FSWatcher>,
): Promise<void> {
    for (const watcher of watchers.values()) watcher.close()
    await Promise.all(
        [...checkers.values()].map((checker) =>
            checker.close().catch(() => {}),
        ),
    )
}

// The directory `ui/` sits under for the file at `path` — the OUTERMOST `ui` on the way up, so a
// component folder that happens to be called `ui` inside an app is not taken for the app — or
// `undefined` where the file is under no `ui/` at all.
function appRootOf(path: string): string | undefined {
    let found: string | undefined
    let at = dirname(path)
    for (;;) {
        if (basename(at) === 'ui') found = dirname(at)
        const up = dirname(at)
        if (up === at) return found
        at = up
    }
}

// How much of a line the finding at `character` underlines: the word that starts there, or one
// character where none does.
function wordLength(line: string, character: number): number {
    const word = /^[\w$]+/.exec(line.slice(character))?.[0]
    return word === undefined ? 1 : word.length
}

// The protocol's `{ line, character }`, from 0, as an offset into `text`. A character is a UTF-16
// code unit in the protocol and in a JavaScript string alike.
function offsetOf(
    text: string,
    position: { line: number; character: number },
): number {
    let at = 0
    for (let line = 0; line < position.line; line += 1) {
        const end = text.indexOf('\n', at)
        if (end === -1) return text.length
        at = end + 1
    }
    return at + position.character
}

// A `Place`, lines and columns from 1, as the protocol's `Location`, from 0.
function locationOf(place: Place): object {
    return {
        uri: Bun.pathToFileURL(place.path).href,
        range: {
            start: {
                line: place.start.line - 1,
                character: place.start.column - 1,
            },
            end: { line: place.end.line - 1, character: place.end.column - 1 },
        },
    }
}
