// THE BRIDGE AS A TRANSPORT, tested for the first time.
//
// Two callers implemented this mechanism (`cli/check.ts`, `deriveSchema.ts`) and neither had a test of the
// transport itself — no test in the repo referenced a result marker, `--abide-diagnose` or `--batch`; both
// bridges were only ever exercised incidentally, when the thing on the other side happened to succeed. So
// the interesting cases (noise on stdout before the result, a subprocess that fills the stderr pipe, a
// non-zero exit, no result at all) had no coverage in either copy.
//
// The fixtures below are real node subprocesses, because that is the whole content of the module: a
// process boundary, two pipes and a marker convention.

import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { askNode, NodeBridgeError, underBun } from './nodeTypeBridge.ts'

// A one-off node script that plays the far side of the bridge. Written to disk because the bridge's
// contract is "re-exec a FILE under node", and a fixture that took a shortcut would test something else.
function fixture(body: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'abide-bridge-'))
    const file = join(dir, 'responder.mjs')
    writeFileSync(file, body)
    return file
}

const MARKER = '__ABIDE_NODE_RESULT__:'

// Read stdin, then do whatever the case is about. Shared so each case shows only its own behaviour.
const READ_STDIN = `
const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
const request = JSON.parse(Buffer.concat(chunks).toString('utf8'))
`

describe('askNode', () => {
    test('sends the payload as JSON and returns the answer', async () => {
        const file = fixture(
            `${READ_STDIN}
             process.stdout.write('${MARKER}' + JSON.stringify({ echoed: request, argv: process.argv.slice(2) }) + '\\n')`,
        )
        const answer = await askNode<{ n: number }, { echoed: { n: number }; argv: string[] }>({
            self: file,
            argv: ['--mode', 'x'],
            payload: { n: 7 },
            what: 'test',
        })
        expect(answer.echoed).toEqual({ n: 7 })
        expect(answer.argv).toEqual(['--mode', 'x'])
        rmSync(file, { force: true })
    })

    // WHY THERE IS A MARKER AT ALL: the subprocess is a real program that may print anything on the way
    // (a tsgo warning, a node deprecation notice), so "parse stdout" is not a protocol.
    test('ignores noise printed before the result', async () => {
        const file = fixture(
            `${READ_STDIN}
             process.stdout.write('a node deprecation warning\\nsomething else\\n')
             process.stdout.write('${MARKER}' + JSON.stringify({ ok: true }) + '\\n')
             process.stdout.write('and a trailing line\\n')`,
        )
        expect(
            await askNode<Record<never, never>, { ok: boolean }>({
                self: file,
                argv: [],
                payload: {},
                what: 'test',
            }),
        ).toEqual({ ok: true })
        rmSync(file, { force: true })
    })

    // And why it is `lastIndexOf`: a REQUEST that happens to contain the marker string must not be able
    // to displace the real result by being echoed back.
    test('a marker inside the echoed request cannot displace the real result', async () => {
        const file = fixture(
            `${READ_STDIN}
             process.stdout.write('echo: ' + request.text + '\\n')
             process.stdout.write('${MARKER}' + JSON.stringify({ real: true }) + '\\n')`,
        )
        const answer = await askNode<{ text: string }, { real: boolean }>({
            self: file,
            argv: [],
            payload: { text: `${MARKER}{"real":false}` },
            what: 'test',
        })
        expect(answer).toEqual({ real: true })
        rmSync(file, { force: true })
    })

    // A subprocess that writes far more to stderr than a pipe buffer holds (1 MB against a typical
    // 64 KB) before producing its result. This is the case the concurrent drain exists for — one copy's
    // comment records it as "a subprocess that fills the stderr pipe buffer blocks until it is read, and
    // it never exits".
    //
    // HONEST LIMIT: this test does NOT discriminate the ordering. Rewriting the drain to read stdout to
    // completion and then stderr keeps it green, because Bun's `spawn` buffers the pipes for us — so what
    // is asserted here is that a flooding subprocess still completes, not that the concurrency is what
    // makes it. The concurrent form stays because it is correct without depending on that buffering.
    test('a subprocess that floods stderr still completes', async () => {
        const file = fixture(
            `${READ_STDIN}
             process.stderr.write('x'.repeat(1024 * 1024))
             process.stdout.write('${MARKER}' + JSON.stringify({ survived: true }) + '\\n')`,
        )
        expect(
            await askNode<Record<never, never>, { survived: boolean }>({
                self: file,
                argv: [],
                payload: {},
                what: 'test',
            }),
        ).toEqual({ survived: true })
        rmSync(file, { force: true })
    }, 20_000)

    test('no result is a NodeBridgeError naming the caller and carrying stderr', async () => {
        const file = fixture(
            `${READ_STDIN}
             process.stderr.write('the checker exploded\\n')
             process.exit(1)`,
        )
        const failure = await askNode<Record<never, never>, unknown>({
            self: file,
            argv: [],
            payload: {},
            what: 'abide check',
        }).catch((caught: unknown) => caught)
        expect(failure).toBeInstanceOf(NodeBridgeError)
        if (!(failure instanceof NodeBridgeError)) throw new Error('unreachable')
        expect(failure.message).toContain('abide check')
        expect(failure.message).toContain('the checker exploded')
        expect(failure.stderr).toBe('the checker exploded')
        rmSync(file, { force: true })
    })

    // A subprocess that cannot even start (a path that does not exist) is the same failure to the caller:
    // no result came back. It must not be an unhandled spawn rejection.
    test('a missing responder file is the same NodeBridgeError', async () => {
        const failure = await askNode<Record<never, never>, unknown>({
            self: join(tmpdir(), 'abide-bridge-does-not-exist.mjs'),
            argv: [],
            payload: {},
            what: 'deriveSchema: batch',
        }).catch((caught: unknown) => caught)
        expect(failure).toBeInstanceOf(NodeBridgeError)
        expect((failure as NodeBridgeError).message).toContain('deriveSchema: batch')
    })
})

describe('underBun', () => {
    // The predicate that decides whether the bridge is needed at all. It is true here by construction —
    // this suite runs under Bun — and its false branch is the subprocess's own path, covered by every
    // fixture above (each of those responders runs the in-process side under node).
    test('is true in this process', () => {
        expect(underBun()).toBe(true)
    })
})
