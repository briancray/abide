// THE `mappings` FIELD OF A SOURCE MAP (revision 3), read and written. The compiler writes one per
// module it emits from a `.abide` (`sourceMapOf`), the server reads them to place a stack frame in
// the `.abide` (`installSourceMaps`), and the client build reads bun's to put the two together —
// bun reads no map it is handed, at run time or in the bundler, so every one of those is ours.

/** Where one generated column came from: `[column, source, line, sourceColumn]`, all from 0. */
export type Segment = [number, number, number, number]

const DIGITS =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const VALUES = new Map<string, number>()
for (let index = 0; index < DIGITS.length; index += 1)
    VALUES.set(DIGITS[index] as string, index)

function vlq(value: number): string {
    let rest = value < 0 ? (-value << 1) | 1 : value << 1
    let out = ''
    do {
        let digit = rest & 31
        rest >>>= 5
        if (rest > 0) digit |= 32
        out += DIGITS[digit]
    } while (rest > 0)
    return out
}

/** Each generated line's segments, ascending by column, as the `mappings` string. */
export function encodeMappings(lines: readonly (readonly Segment[])[]): string {
    let out = ''
    let source = 0
    let line = 0
    let sourceColumn = 0
    for (let index = 0; index < lines.length; index += 1) {
        if (index > 0) out += ';'
        let column = 0
        const segments = lines[index] as readonly Segment[]
        for (let at = 0; at < segments.length; at += 1) {
            const segment = segments[at] as Segment
            if (at > 0) out += ','
            out +=
                vlq(segment[0] - column) +
                vlq(segment[1] - source) +
                vlq(segment[2] - line) +
                vlq(segment[3] - sourceColumn)
            column = segment[0]
            source = segment[1]
            line = segment[2]
            sourceColumn = segment[3]
        }
    }
    return out
}

/**
 * A `mappings` string as each generated line's segments. A segment naming no source — one field
 * long — places nothing, and is dropped.
 */
export function decodeMappings(mappings: string): Segment[][] {
    const lines: Segment[][] = [[]]
    const fields: number[] = []
    let source = 0
    let line = 0
    let sourceColumn = 0
    let column = 0
    let value = 0
    let shift = 0
    const close = (): void => {
        if (fields.length >= 4) {
            column += fields[0] as number
            source += fields[1] as number
            line += fields[2] as number
            sourceColumn += fields[3] as number
            ;(lines[lines.length - 1] as Segment[]).push([
                column,
                source,
                line,
                sourceColumn,
            ])
        } else if (fields.length > 0) column += fields[0] as number
        fields.length = 0
    }
    for (const character of mappings) {
        if (character === ';') {
            close()
            lines.push([])
            column = 0
            continue
        }
        if (character === ',') {
            close()
            continue
        }
        const digit = VALUES.get(character) ?? 0
        value |= (digit & 31) << shift
        if (digit & 32) {
            shift += 5
            continue
        }
        fields.push(value & 1 ? -(value >>> 1) : value >>> 1)
        value = 0
        shift = 0
    }
    close()
    return lines
}

/**
 * Where `column` on generated `line` came from: the last segment at or before it, or the line's
 * first where the column is before every one — a frame's column points into an expression, and
 * the segment is its start.
 */
export function segmentAt(
    lines: readonly (readonly Segment[])[],
    line: number,
    column: number,
): Segment | undefined {
    const segments = lines[line]
    if (segments === undefined || segments.length === 0) return undefined
    let found = segments[0] as Segment
    for (const segment of segments) {
        if (segment[0] > column) break
        found = segment
    }
    return found
}

/**
 * The `[line, column]` generated `line` and `column` came from. Within a segment the run was copied
 * as written, so the column moves with it.
 */
export function placeAt(
    lines: readonly (readonly Segment[])[],
    line: number,
    column: number,
): [number, number] | undefined {
    const segment = segmentAt(lines, line, column)
    if (segment === undefined) return undefined
    return [segment[2], segment[3] + Math.max(column - segment[0], 0)]
}
