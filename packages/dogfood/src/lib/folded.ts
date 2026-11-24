// The column a sample renders in, as the repo's formatter sets it (`bunfig.toml`'s `printWidth`).
const COLUMN = 80

/**
 * Each line past the column, broken where it breaks best — after a `; `, a `, `, a `,` or a space —
 * and carried on indented beneath itself, so an answer reads in the column rather than scrolling out
 * of it.
 */
export function folded(text: string): string {
    const lines: string[] = []
    for (const whole of text.split('\n')) {
        let line = whole
        const indent = `${/^\s*/.exec(line)?.[0] ?? ''}  `
        while (line.length > COLUMN) {
            let at = -1
            for (const mark of ['; ', ', ', ',', ' ']) {
                const found = line.lastIndexOf(mark, COLUMN - mark.length)
                if (found > indent.length) {
                    at = found + mark.length
                    break
                }
            }
            if (at === -1) at = COLUMN
            lines.push(line.slice(0, at).trimEnd())
            line = indent + line.slice(at)
        }
        lines.push(line)
    }
    return lines.join('\n')
}
