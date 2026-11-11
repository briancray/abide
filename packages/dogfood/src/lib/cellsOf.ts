/** A table row's cells — a cell ends at the first UNESCAPED pipe, a signature carrying `\|`. */
export function cellsOf(line: string): string[] {
    const out: string[] = []
    let start = 1
    for (let at = 1; at <= line.length; at += 1) {
        if (at < line.length && !(line[at] === '|' && line[at - 1] !== '\\'))
            continue
        out.push(line.slice(start, at).trim().replaceAll('\\|', '|'))
        start = at + 1
    }
    return out.slice(0, -1)
}
