import type { Diagnosis } from './TypeSession.ts'

// 38.3 — an offset into a file's text as the line and column an editor shows, both from 1.
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

// abide's own finding at `offset` into `text`, or at line 0 where the text was not handed in.
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
