// `abide lsp` — the language server, as a process.
//
// A shell over `language.ts`, which is where every answer already lives. What is here is the three
// things a pure server cannot have: the stream it reads, the stream it writes, and a checker.
//
// stdin and stdout ARE the protocol, which is the one rule this file exists to keep: nothing may
// `console.log`. A stray line on stdout is a frame the client cannot parse and the session is over,
// so everything this process has to say — a checker that would not start, a crash — goes to stderr,
// where an editor shows it in an output pane and the protocol never sees it.

import { LiveCheck, type Placed } from '#compiler/live.ts'
import { CLI_EXIT_CODES } from '../CLI_EXIT_CODES.ts'
import { takesNothing } from '../COMMANDS.ts'
import { type Diagnostic, LanguageServer, type Severity } from './language.ts'

/**
 * The checker's category as LSP's severity, indexed by the one and holding the other.
 *
 * `0` warning, `1` error, `2` suggestion, `3` message on the way in; `1` error, `2` warning, `3`
 * information, `4` hint on the way out. ONE table, and it is here rather than half here and half in
 * the compiler: a vocabulary invented in the middle would have to be kept in step at both ends, and
 * the middle had exactly one producer and one consumer.
 */
const SEVERITIES: Severity[] = [2, 1, 4, 3]

/** A place on the `.abide` line as LSP says one: zero-based, and a range rather than a point. */
function diagnostics(found: Placed[]): Diagnostic[] {
    const out: Diagnostic[] = []
    for (const one of found) {
        out.push({
            range: {
                start: { line: one.line - 1, character: one.column - 1 },
                end: { line: one.endLine - 1, character: one.endColumn - 1 },
            },
            severity: SEVERITIES[one.category] ?? 1,
            source: 'abide',
            // `TS2339`, the way `abide check` prints it — an editor shows it beside the message and
            // it is what somebody searches for.
            code: `TS${one.code}`,
            message: one.message,
        })
    }
    return out
}

export async function lsp(argv: string[]): Promise<number> {
    // No flags and no paths: which files to look at is the EDITOR's to say, over the wire, and a
    // root named here would be a second answer to the same question.
    const refused = takesNothing('lsp', argv)
    if (refused !== null) return refused

    const checker = new LiveCheck({ log: (text) => console.error(text) })
    const out = Bun.stdout.writer()
    const finished = Promise.withResolvers<number>()

    const server = new LanguageServer({
        write: (message) => {
            out.write(message)
            void out.flush()
        },
        types: async (document) => diagnostics(await checker.of(document.path, document.text)),
        typeAt: (document, line, character) => checker.typeAt(document.path, document.text, line, character),
        definitionAt: (document, line, character) =>
            checker.definitionAt(document.path, document.text, line, character),
        exit: finished.resolve,
    })

    const reading = (async () => {
        for await (const chunk of Bun.stdin.stream()) server.feed(chunk)
        // The client closed the pipe without saying goodbye — an editor that was killed. There is
        // nothing left to serve, and it is not this process's failure.
        return CLI_EXIT_CODES.ok
    })()

    const code = await Promise.race([finished.promise, reading])
    checker.close()
    await out.end()
    return code
}
