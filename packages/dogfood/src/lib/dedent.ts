/** `lines` joined, with the margin every non-blank line shares taken off. */
export function dedent(lines: string[]): string {
    let margin = Infinity
    for (const line of lines) {
        if (!line.trim()) continue
        margin = Math.min(margin, line.length - line.trimStart().length)
    }
    if (!Number.isFinite(margin) || margin === 0) return lines.join('\n')
    const out: string[] = []
    for (const line of lines) out.push(line.slice(margin))
    return out.join('\n')
}
