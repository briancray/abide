/* An absolute offset → LSP `{ line, character }` (0-based, UTF-16 code units). */
export function offsetToPosition(
    text: string,
    offset: number,
): { line: number; character: number } {
    const before = text.slice(0, offset)
    const line = before.split('\n').length - 1
    return { line, character: offset - (before.lastIndexOf('\n') + 1) }
}
