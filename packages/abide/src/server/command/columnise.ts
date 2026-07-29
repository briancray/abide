// columnise(items, width) — lay names out in aligned columns, filling DOWN then across.
//
// The REPL banner used to print every command on one line, comma-separated. On the docs app that is
// 59 names in a ~900-character wrap — technically the list, practically unreadable, and it pushed the
// one line that says what to DO off the top of a short terminal. Columns make the same list scannable
// and cost the same bytes.
//
// Down-then-across, like `ls`: reading order for a sorted list runs down a column, so the alphabet
// stays contiguous under your eye instead of zig-zagging across the row.
const GUTTER = 2

export function columnise(items: string[], width: number, indent = 2): string[] {
    if (items.length === 0) return []
    const longest = items.reduce((most, item) => Math.max(most, item.length), 0)
    const cellWidth = longest + GUTTER
    // At least one column however narrow the terminal is — a name wider than the window still gets
    // its own row rather than being dropped or truncated.
    const columns = Math.max(1, Math.floor((width - indent) / cellWidth))
    const rows = Math.ceil(items.length / columns)

    const lines: string[] = []
    for (let row = 0; row < rows; row++) {
        let line = ''
        for (let column = 0; column < columns; column++) {
            const item = items[column * rows + row]
            if (item === undefined) continue
            // The last cell on a row is not padded — trailing spaces are invisible and would be the
            // only thing on the line if the terminal is later resized narrower.
            const last = column === columns - 1 || items[(column + 1) * rows + row] === undefined
            line += last ? item : item.padEnd(cellWidth)
        }
        lines.push(' '.repeat(indent) + line)
    }
    return lines
}
