import { existsSync, type FSWatcher, watch } from 'node:fs' // bun exposes no file watcher or sync existence check of its own
import { dirname } from 'node:path' // bun exposes no path helpers of its own
import { realOrAsGiven } from '#server/realOrAsGiven.ts'
import { checkSource } from './checkApp.ts'
import { type AppChecker, openChecker } from './compileApp.ts'
import { nearest } from './nearest.ts'
import type { Diagnosis, Inspection, Place } from './TypeSession.ts'

// 38.11 — `abide lsp`: THE `.abide` LANGUAGE SERVER, OVER STDIO. It is `abide check` (38.3) asked
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
// monorepo is not an app at all, so each document is checked against the root of the NEAREST
// package above it (`appRootOf`) — with one checker per app, kept for the session.
// `--root` pins every document to one.
//
// THE EDITOR'S SPELLING STOPS HERE. An app opened through a link (`/tmp` is one on macOS) is
// checked at its real path, the one bun resolves every import to (`openChecker`), so a path is
// made real on its way in (`placed`) and spelled under the link again on its way out (`spelled`).
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

/** The protocol's `DiagnosticSeverity`. */
const SEVERITY: Record<Diagnosis['category'], number> = {
    error: 1,
    warning: 2,
    message: 3,
    suggestion: 4,
}

/** Answers the language server protocol read from `input` until the client exits. */
export async function serveLanguage(
    root: string | undefined,
    input: ReadableStream<Uint8Array>,
    write: (bytes: Uint8Array) => void,
): Promise<void> {
    const documents = new Map<string, Document>()
    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    const checkers = new Map<string, AppChecker>()
    const watchers = new Map<string, FSWatcher>()
    // Each app's real root, to the root the editor reached it by.
    const links = new Map<string, string>()
    let queue: Promise<void> = Promise.resolve()

    // The document at `uri`, in its app's real spelling; `undefined` where no app holds it.
    const placed = (uri: string): { app: string; path: string } | undefined => {
        const path = Bun.fileURLToPath(uri)
        const given = root ?? appRootOf(path)
        if (given === undefined) return undefined
        const app = realOrAsGiven(given)
        if (app !== given) links.set(app, given)
        return {
            app,
            path: path.startsWith(`${given}/`)
                ? `${app}${path.slice(given.length)}`
                : path,
        }
    }

    // `path`, real, under the root the editor reached its app by.
    const spelled = (path: string): string => {
        for (const [app, given] of links)
            if (path.startsWith(`${app}/`))
                return `${given}${path.slice(app.length)}`
        return path
    }

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
                        if (placed(uri)?.app === app) check(uri)
                }),
            )
        return checker
    }

    const run = async (uri: string): Promise<void> => {
        const document = documents.get(uri)
        if (document === undefined) return
        const version = document.version
        // A `.abide` belonging to no app has nothing to be checked against.
        const at = placed(uri)
        if (at === undefined) return
        const { app, path } = at
        let found: Diagnosis[]
        try {
            found = await checkSource(
                await checkerOf(app),
                path,
                document.text,
                (held) =>
                    documents.get(Bun.pathToFileURL(spelled(held)).href)?.text,
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
    const inspect = (params: unknown): Promise<Inspection | undefined> =>
        ask(params, (session, path, text, offset) =>
            session.inspect(path, text, offset),
        )

    const ask = <Answer>(
        params: unknown,
        question: (
            session: AppChecker['session'],
            path: string,
            text: string,
            offset: number,
        ) => Promise<Answer | undefined>,
    ): Promise<Answer | undefined> => {
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
            const at = placed(uri)
            if (document === undefined || at === undefined) return undefined
            return question(
                (await checkerOf(at.app)).session,
                at.path,
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
                            completionProvider: { triggerCharacters: ['.'] },
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
            // 38.98 — the protocol's `CompletionItemKind` is the checker's own numbering.
            case 'textDocument/completion': {
                const trigger = (
                    params?.context as { triggerCharacter?: string } | undefined
                )?.triggerCharacter
                const found = await ask(params, (session, path, text, offset) =>
                    session.complete(path, text, offset, trigger),
                )
                const items: object[] = []
                for (const entry of found?.entries ?? [])
                    items.push({
                        label: entry.name,
                        kind: entry.kind,
                        sortText: entry.sortText,
                        filterText: entry.filterText,
                        insertText: entry.insertText,
                        detail: entry.detail,
                        labelDetails: entry.labelDetails,
                    })
                send({
                    id: message.id,
                    result:
                        found === undefined
                            ? null
                            : { isIncomplete: found.isIncomplete, items },
                })
                return true
            }
            case 'textDocument/definition': {
                const found = await inspect(params)
                const locations: object[] = []
                for (const place of found?.definitions ?? [])
                    locations.push(locationOf(spelled(place.path), place))
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

/**
 * The app a file at `path` belongs to: the root 38.25 finds from the nearest package above it.
 *
 * That package's `src` where it has one, and the package itself where it does not — the same root
 * `abide dev` run in that package would find. `undefined` where no package lies above the file.
 */
function appRootOf(path: string): string | undefined {
    const manifest = nearest(dirname(path), 'package.json')
    if (manifest === undefined) return undefined
    const at = dirname(manifest)
    return existsSync(`${at}/src`) ? `${at}/src` : at
}

/**
 * How much of a line the finding at `character` underlines: the word that starts there, or one
 * character where none does.
 */
function wordLength(line: string, character: number): number {
    const word = /^[\w$]+/.exec(line.slice(character))?.[0]
    return word === undefined ? 1 : word.length
}

/**
 * The protocol's `{ line, character }`, from 0, as an offset into `text`. A character is a UTF-16
 * code unit in the protocol and in a JavaScript string alike.
 */
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

/** A `Place` at `path`, lines and columns from 1, as the protocol's `Location`, from 0. */
function locationOf(path: string, place: Place): object {
    return {
        uri: Bun.pathToFileURL(path).href,
        range: {
            start: {
                line: place.start.line - 1,
                character: place.start.column - 1,
            },
            end: { line: place.end.line - 1, character: place.end.column - 1 },
        },
    }
}
