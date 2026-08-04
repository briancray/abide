// The REPL's line input. These assert KEYSTROKES, not lines — which is the whole point: the old
// reader passed every one of these tests' worth of "does a line arrive" while backspace, the arrow
// keys and ctrl-c were all broken, because it never saw a keystroke at all. What was wrong could
// only be stated as "\x7f must erase a character rather than become one".

import { describe, expect, test } from 'bun:test'
import { PassThrough } from 'node:stream'
import { until } from '../../test/internal/until.ts'
import { lineReader } from './lineReader.ts'

// A terminal reader over a pair of pipes. `terminalInput`/`terminalOutput` exist for this: readline
// needs real Node streams and a `terminal: true` interface, neither of which a test has.
function atTerminal(): {
    reader: ReturnType<typeof lineReader>
    type(keys: string): Promise<void>
    printed(): string
} {
    const input = new PassThrough()
    const output = new PassThrough()
    const chunks: string[] = []
    output.on('data', (chunk: Buffer) => chunks.push(chunk.toString()))
    const reader = lineReader({
        input: new ReadableStream<Uint8Array>({ start: (c) => c.close() }),
        tty: true,
        write: () => {},
        terminalInput: input,
        terminalOutput: output,
    })
    return {
        reader,
        type: (keys: string) =>
            new Promise<void>((resolve) => {
                input.write(keys)
                setImmediate(resolve)
            }),
        printed: () => chunks.join(''),
    }
}

const BACKSPACE = '\x7f'
const UP = '\x1b[A'
const DOWN = '\x1b[B'
const CTRL_C = '\x03'
const TAB = '\t'
const LEFT = '\x1b[D'

describe('at a terminal', () => {
    test('backspace erases a character instead of entering one', async () => {
        const { reader, type } = atTerminal()
        const line = reader.read('> ')
        await type('cacha')
        await type(BACKSPACE)
        await type('e\n')
        // It used to arrive as `cacha\x7fe` — the literal control byte, sent to the server.
        expect(await line).toBe('cache')
        reader.close()
    })

    test('the up arrow recalls previous commands, the down arrow walks back', async () => {
        const { reader, type } = atTerminal()
        const first = reader.read('> ')
        await type('cacheTtl\n')
        expect(await first).toBe('cacheTtl')

        const second = reader.read('> ')
        await type('rpcCreateNote\n')
        expect(await second).toBe('rpcCreateNote')

        const third = reader.read('> ')
        await type(UP)
        await type(UP)
        await type(DOWN)
        await type('\n')
        // Two back is `cacheTtl`, one forward is `rpcCreateNote` again.
        expect(await third).toBe('rpcCreateNote')
        reader.close()
    })

    test('ctrl-c abandons a typed line and prompts again — it does not end the session', async () => {
        const { reader, type, printed } = atTerminal()
        const abandoned = reader.read('> ')
        await type('cachaeee')
        await type(CTRL_C)
        // The read is still outstanding: ctrl-c cost the line, not the session.
        await type('cacheTtl\n')
        expect(await abandoned).toBe('cacheTtl')
        expect(printed()).toContain('^C')
        reader.close()
    })

    test('ctrl-c on an already-empty line ends the session', async () => {
        const { reader, type } = atTerminal()
        const line = reader.read('> ')
        await type(CTRL_C)
        // Undefined is what the REPL loop reads as "leave" — so `serve`'s "ctrl-c stops it" still
        // holds at a bare prompt, which is where anyone watching a running server would press it.
        expect(await line).toBeUndefined()
    })

    test('TAB completes through the injected completer', async () => {
        const { reader, type } = atTerminal()
        const line = reader.read('> ', {
            complete: (typed) => ({
                candidates: ['createNote', 'createUser'].filter((name) => name.startsWith(typed)),
                partial: typed,
            }),
        })
        await type('createN')
        await type(TAB)
        await type('\n')
        // One hit, so readline substitutes it outright.
        expect(await line).toBe('createNote')
        reader.close()
    })

    test('TAB with several hits completes the common prefix and leaves the rest', async () => {
        const { reader, type, printed } = atTerminal()
        const line = reader.read('> ', {
            complete: (typed) => ({
                candidates: ['createNote', 'createUser'].filter((name) => name.startsWith(typed)),
                partial: typed,
            }),
        })
        await type('cr')
        await type(TAB)
        // A second TAB lists them, bash-style — the first only extends to the unambiguous prefix.
        await type(TAB)
        await type('\n')
        expect(await line).toBe('create')
        expect(printed()).toContain('createNote')
        expect(printed()).toContain('createUser')
        reader.close()
    })

    test('a read with no completer leaves TAB alone rather than eating the word', async () => {
        const { reader, type } = atTerminal()
        const line = reader.read('> ')
        await type('raw')
        await type(TAB)
        await type('\n')
        expect(await line).toBe('raw')
        reader.close()
    })

    // ── inline suggestion ────────────────────────────────────────────────────────────────────────
    const DIM = '\x1b[2m'
    const RIGHT = '\x1b[C'
    const completes = (names: string[]) => (typed: string) => ({
        candidates: names.filter((name) => name.startsWith(typed)).sort(),
        partial: typed,
    })

    test('the best candidate is painted DIM after the cursor, and is not part of the line', async () => {
        const { reader, type, printed } = atTerminal()
        const line = reader.read('> ', { complete: completes(['cacheTtl', 'cacheCounter']) })
        await type('cacheT')
        await until('the suggestion was painted', () => printed().includes(`${DIM}tl`))
        // Only the REMAINDER is drawn, dimmed, then the cursor walks back over it.
        expect(printed()).toContain(`${DIM}tl`)
        await type('\n')
        // …and pressing Enter submits what was TYPED. A suggestion you did not accept must never end
        // up in the buffer — that is the difference between a hint and an autocorrect.
        expect(await line).toBe('cacheT')
        reader.close()
    })

    test('the right arrow at the end of the line accepts it', async () => {
        const { reader, type, printed } = atTerminal()
        const line = reader.read('> ', { complete: completes(['cacheTtl']) })
        await type('cacheT')
        // The arrow can only accept a suggestion that has been PAINTED, so that is the thing to wait
        // for — a fixed 20ms was a guess at how long the reader's loop takes to get there.
        await until('the suggestion was painted', () => printed().includes(`${DIM}tl`))
        await type(RIGHT)
        await new Promise((resolve) => setTimeout(resolve, 20))
        await type('\n')
        expect(await line).toBe('cacheTtl')
        reader.close()
    })

    test('a display-only hint is painted dim but the right arrow does NOT take it', async () => {
        const { reader, type, printed } = atTerminal()
        const line = reader.read('> ', {
            complete: () => ({ candidates: [], partial: '', hint: '--name <string>' }),
        })
        await type('rpcGreet ')
        await until('the hint was painted', () => printed().includes(`${DIM}--name <string>`))
        expect(printed()).toContain(`${DIM}--name <string>`)
        await type(RIGHT)
        await new Promise((resolve) => setTimeout(resolve, 20))
        await type('\n')
        // Accepting it would insert `--name <string>` literally, which is not a command line.
        expect(await line).toBe('rpcGreet ')
        reader.close()
    })

    test('a real candidate still wins over the hint, and is still acceptable', async () => {
        const { reader, type, printed } = atTerminal()
        const line = reader.read('> ', {
            complete: (typed) => ({
                candidates: typed.endsWith('--na') ? ['--name'] : [],
                partial: typed.endsWith('--na') ? '--na' : '',
                hint: '--name <string>',
            }),
        })
        await type('rpcGreet --na')
        await until('the candidate remainder was painted', () => printed().includes(`${DIM}me`))
        await type(RIGHT)
        await new Promise((resolve) => setTimeout(resolve, 20))
        await type('\n')
        expect(await line).toBe('rpcGreet --name')
        reader.close()
    })

    test('a hint paints the whole signature but the right arrow takes only the flag', async () => {
        const { reader, type, printed } = atTerminal()
        const line = reader.read('> ', {
            complete: (typed) =>
                typed.endsWith(' ')
                    ? { candidates: ['--name'], partial: '', hint: '--name <string> --loud' }
                    : { candidates: [], partial: typed },
        })
        await type('rpcGreet ')
        await until('the signature was painted', () =>
            printed().includes(`${DIM}--name <string> --loud`),
        )
        // Painted: the signature, so you can see what the command takes.
        expect(printed()).toContain(`${DIM}--name <string> --loud`)
        await type(RIGHT)
        await new Promise((resolve) => setTimeout(resolve, 20))
        await type('\n')
        // Accepted: the flag alone. `--name <string>` is a placeholder, not a command line.
        expect(await line).toBe('rpcGreet --name')
        reader.close()
    })

    test('nothing is suggested with the cursor parked mid-line', async () => {
        const { reader, type, printed } = atTerminal()
        const line = reader.read('> ', { complete: completes(['cacheTtl']) })
        // This one sets the BASELINE for the negative assertion below, so it has to wait for the paint
        // rather than guess: a suggestion that landed after `before` was captured would be invisible to
        // the slice, and the test would pass for the wrong reason.
        await type('cacheT')
        await until('the suggestion was painted', () => printed().includes(DIM))
        const before = printed().length
        await type(LEFT)
        await new Promise((resolve) => setTimeout(resolve, 20))
        // A suggestion drawn mid-edit would sit between the cursor and the text being edited around.
        expect(printed().slice(before)).not.toContain(DIM)
        await type('\n')
        await line
        reader.close()
    })

    test('a read with no completer suggests nothing', async () => {
        const { reader, type, printed } = atTerminal()
        const line = reader.read('> ')
        await type('cacheT')
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(printed()).not.toContain(DIM)
        await type('\n')
        await line
        reader.close()
    })

    test('a field answer is not recalled as if it were a command', async () => {
        const { reader, type } = atTerminal()
        const command = reader.read('> ')
        await type('rpcCreateNote\n')
        await command

        const field = reader.read('  title (string, required): ', { history: false })
        await type('groceries\n')
        expect(await field).toBe('groceries')

        const next = reader.read('> ')
        await type(UP)
        await type('\n')
        // `groceries` is a value, not a command; the up arrow must reach past it.
        expect(await next).toBe('rpcCreateNote')
        reader.close()
    })
})

describe('through a pipe', () => {
    // The scripted path (`printf 'greet\n' | app`) must be byte-identical to what it was — no raw
    // mode, no escape-sequence interpretation, prompts still written to the output sink.
    function piped(text: string): {
        reader: ReturnType<typeof lineReader>
        written(): string
    } {
        const written: string[] = []
        const reader = lineReader({
            input: new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode(text))
                    controller.close()
                },
            }),
            tty: false,
            write: (chunk) => written.push(chunk),
        })
        return { reader, written: () => written.join('') }
    }

    test('reads newline-framed lines and writes each prompt', async () => {
        const { reader, written } = piped('greet\nexit\n')
        expect(await reader.read('> ')).toBe('greet')
        expect(await reader.read('> ')).toBe('exit')
        expect(await reader.read('> ')).toBeUndefined()
        expect(written()).toBe('> > > ')
    })

    test('an escape sequence stays literal — a pipe has no cursor to move', async () => {
        const { reader } = piped(`up${UP}\n`)
        expect(await reader.read('> ')).toBe(`up${UP}`)
    })

    test('a trailing line with no newline still arrives', async () => {
        const { reader } = piped('greet')
        expect(await reader.read('> ')).toBe('greet')
        expect(await reader.read('> ')).toBeUndefined()
    })
})
