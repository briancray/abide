/*
Converts an absolute source offset to 1-based `{ line, column }`. Used to turn a
compile error's tracked offset into a human location for the loader's message
(Bun frames plugin throws at `<file>:0`, so abide carries the real position in the
message text itself).
*/
export function offsetToLineColumn(
    source: string,
    offset: number,
): { line: number; column: number } {
    const clamped = Math.max(0, Math.min(offset, source.length))
    const preceding = source.slice(0, clamped)
    const line = preceding.split('\n').length
    const column = clamped - (preceding.lastIndexOf('\n') + 1) + 1
    return { line, column }
}
