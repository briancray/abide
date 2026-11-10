import { lastAtOrBefore } from './lastAtOrBefore.ts'

/** Where each line of `text` starts, ascending — the line index `lineAt` searches. */
export function lineStarts(text: string): number[] {
    const starts = [0]
    for (
        let at = text.indexOf('\n');
        at !== -1;
        at = text.indexOf('\n', at + 1)
    )
        starts.push(at + 1)
    return starts
}

const itself = (start: number): number => start

/** The line, from 0, that `offset` stands on, given the text's `lineStarts`. */
export function lineAt(starts: readonly number[], offset: number): number {
    return Math.max(lastAtOrBefore(starts, itself, offset), 0)
}

// The last text `lineOf` was asked of and its line index: its callers place every finding, span or
// diagnostic of one text in a row, and a scan from 0 per offset was O(offsets x length).
let indexed = ''
let indexedStarts: number[] = [0]

/**
 * An offset into a file's text as the line and column an editor shows, both from 1.
 *
 * 38.3.
 */
export function lineOf(
    text: string,
    offset: number,
): { line: number; column: number } {
    if (text !== indexed) {
        indexed = text
        indexedStarts = lineStarts(text)
    }
    const end = Math.min(offset, text.length)
    const line = lineAt(indexedStarts, end)
    return { line: line + 1, column: end - (indexedStarts[line] as number) + 1 }
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
