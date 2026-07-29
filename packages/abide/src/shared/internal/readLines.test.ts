// `readLines` replaced three hand-written copies of the same loop. These assert the two properties the
// copies each had a chance to get wrong, and that no caller-visible framing changed.

import { describe, expect, test } from 'bun:test'
import { readLines } from './readLines.ts'

// Feed bytes in caller-chosen slices, so a test can split a multi-byte character across chunks.
async function* bytes(...chunks: Uint8Array[]): AsyncGenerator<Uint8Array> {
    for (const chunk of chunks) yield chunk
}

function utf8(text: string): Uint8Array {
    return new TextEncoder().encode(text)
}

async function collect(input: AsyncIterable<Uint8Array>): Promise<string[]> {
    const lines: string[] = []
    for await (const line of readLines(input)) lines.push(line)
    return lines
}

describe('readLines', () => {
    test('frames on newlines and does not emit a phantom line for a trailing terminator', async () => {
        expect(await collect(bytes(utf8('a\nb\nc\n')))).toEqual(['a', 'b', 'c'])
    })

    test('an unterminated final line is still yielded', async () => {
        expect(await collect(bytes(utf8('a\nb')))).toEqual(['a', 'b'])
    })

    test('a line split across chunk boundaries is reassembled', async () => {
        expect(await collect(bytes(utf8('he'), utf8('llo\nwor'), utf8('ld\n')))).toEqual([
            'hello',
            'world',
        ])
    })

    // The reason the decoder is stateful (`{ stream: true }` + a final argless `decode()`). Splitting a
    // 4-byte emoji down the middle is the case a naive per-chunk `new TextDecoder().decode(chunk)`
    // corrupts into replacement characters — and it is invisible to any ASCII-only test, which is what
    // made three copies of this loop a real risk rather than a tidiness complaint.
    test('a multi-byte character split across chunks survives', async () => {
        const encoded = utf8('a🎉b\n')
        const split = 2 // lands inside the 4-byte emoji
        const lines = await collect(bytes(encoded.slice(0, split), encoded.slice(split)))
        expect(lines).toEqual(['a🎉b'])
        expect(lines[0]).not.toContain('�')
    })

    test('a multi-byte character at the very end is flushed by the final decode', async () => {
        const encoded = utf8('done🎉')
        const lines = await collect(bytes(encoded.slice(0, encoded.length - 2), encoded.slice(-2)))
        expect(lines).toEqual(['done🎉'])
    })

    test('lines are yielded RAW — trimming and blank-skipping are the caller’s choice', async () => {
        // `logsCommand`/`callCliCommand` apply `.trimEnd()` per line; a `\r` must reach them to be
        // trimmed, so this must NOT strip it here.
        expect(await collect(bytes(utf8('a\r\n\nb\n')))).toEqual(['a\r', '', 'b'])
    })

    test('an empty stream yields nothing', async () => {
        expect(await collect(bytes())).toEqual([])
        expect(await collect(bytes(utf8('')))).toEqual([])
    })
})
