import type { Diagnosis } from './TypeSession.ts'

/**
 * An offset into a file's text as the line and column an editor shows, both from 1.
 *
 * 38.3.
 */
export function lineOf(
    text: string,
    offset: number,
): { line: number; column: number } {
    let line = 1
    let lineStart = 0
    const end = Math.min(offset, text.length)
    for (let at = 0; at < end; at += 1)
        if (text.charCodeAt(at) === 10) {
            line += 1
            lineStart = at + 1
        }
    return { line, column: end - lineStart + 1 }
}

/**
 * The protocol's `{ line, character }`, from 0, as an offset into `text`. A character is a UTF-16
 * code unit in the protocol and in a JavaScript string alike.
 */
export function offsetOf(
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

/** abide's own finding at `offset` into `text`, or at line 0 where the text was not handed in. */
export function diagnosisAt(
    path: string,
    text: string | undefined,
    offset: number,
    category: Diagnosis['category'],
    message: string,
): Diagnosis {
    return {
        path,
        ...(text === undefined ? { line: 0, column: 0 } : lineOf(text, offset)),
        code: 0,
        category,
        message,
    }
}
