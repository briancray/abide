// 38.97 — WHERE A COMPILED MODULE'S LINES CAME FROM IN ITS `.abide`. The emitters build a module
// as text around what `Lowering` hands them, so a chunk is placed by FINDING it in what they wrote
// rather than by threading offsets through every template string that assembles one:
//
// - a script block is many lines and lands whole, its imports each left as a `;` on as many lines
//   (`splitImports`), so it is anchored by its longest line found once in the module and then read
//   line for line;
// - a template expression is one line and may land more than once — a client module writes a slot
//   in its markup and again in the effect that updates it — and every landing is the same source.
//
// What no chunk covers is the framework's own scaffolding, and maps to nothing.

import { encodeMappings, type Segment } from '#server/sourceMappings.ts'

import type { LoweredChunk } from './Lowering.ts'
import type { Origin } from './projectShadow.ts'
import { mapBack } from './ShadowMap.ts'

/** The module's `mappings`, into the `.abide` whose text is `source`. */
export function sourceMapOf(
    output: string,
    chunks: readonly LoweredChunk[],
    projected: readonly Origin[],
    source: string,
): string {
    const sourceStarts = lineStarts(source)
    const outputLines = output.split('\n')
    const outputStarts = lineStarts(output)
    const lines: Segment[][] = []
    for (let index = 0; index < outputLines.length; index += 1) lines.push([])
    // Where a projection offset is in the `.abide`, as a line and a column.
    const place = (line: number, column: number, offset: number): void => {
        const at = mapBack(projected, offset)
        const sourceLine = lineAt(sourceStarts, at)
        ;(lines[line] as Segment[]).push([
            column,
            0,
            sourceLine,
            at - (sourceStarts[sourceLine] as number),
        ])
    }
    const claimed = new Set<number>()

    const multiline: LoweredChunk[] = []
    const single: LoweredChunk[] = []
    for (const chunk of chunks)
        (chunk.text.includes('\n') ? multiline : single).push(chunk)
    multiline.sort((one, two) => two.text.length - one.text.length)

    for (const chunk of multiline) {
        const chunkLines = chunk.text.split('\n')
        const first = anchor(chunkLines, outputLines, outputStarts, output)
        if (first === undefined) continue
        const chunkStarts = lineStarts(chunk.text)
        for (let index = 0; index < chunkLines.length; index += 1) {
            const line = first + index
            const written = outputLines[line]
            const lowered = chunkLines[index] as string
            if (written === undefined || claimed.has(line)) continue
            if (written.trim() !== lowered.trim() || lowered.trim() === '')
                continue
            claimed.add(line)
            const start = chunkStarts[index] as number
            const end = start + lowered.length
            // Lines the emitter re-indented keep their text, and move by the margin it added.
            const shift = written.length - lowered.length
            for (const origin of chunk.origins) {
                const runEnd = origin.at + Math.max(origin.length, 1)
                if (origin.at >= end || runEnd <= start) continue
                const from = Math.max(origin.at, start)
                place(
                    line,
                    from - start + shift,
                    origin.source + (from - origin.at),
                )
            }
        }
    }

    // LONGEST FIRST, each landing claimed: `count() + 1` is found again inside the handler
    // `() => { count.set(count() + 1) }` was lowered from, and is that handler's there.
    single.sort((one, two) => two.text.trim().length - one.text.trim().length)
    const taken: [number, number][] = []
    const seen = new Set<string>()
    for (const chunk of single) {
        const text = chunk.text.trim()
        if (text.length < 2) continue
        // An expression an emitter asked for twice is one chunk.
        const key = `${chunk.origins[0]?.source}:${text}`
        if (seen.has(key)) continue
        seen.add(key)
        const lead = chunk.text.indexOf(text)
        for (
            let found = output.indexOf(text);
            found !== -1;
            found = output.indexOf(text, found + text.length)
        ) {
            const end = found + text.length
            if (!standsAlone(output, found, end)) continue
            const line = lineAt(outputStarts, found)
            if (claimed.has(line)) continue
            if (taken.some(([from, to]) => found < to && end > from)) continue
            taken.push([found, end])
            const column = found - (outputStarts[line] as number)
            for (const origin of chunk.origins) {
                const at = origin.at - lead
                if (at < 0 || at > text.length) continue
                place(line, column + at, origin.source)
            }
        }
    }

    // Two runs placed at one column — a pin and the copy after it — keep the later, which is the
    // author's own text.
    for (const segments of lines) {
        segments.sort((one, two) => one[0] - two[0])
        for (let at = segments.length - 1; at > 0; at -= 1)
            if (
                (segments[at - 1] as Segment)[0] ===
                (segments[at] as Segment)[0]
            )
                segments.splice(at - 1, 1)
    }
    return encodeMappings(lines)
}

/**
 * The module line `chunkLines` starts on: its longest line found exactly once, standing where the
 * rest of the chunk agrees — or `undefined` where no line places it.
 */
function anchor(
    chunkLines: readonly string[],
    outputLines: readonly string[],
    outputStarts: readonly number[],
    output: string,
): number | undefined {
    const order: number[] = []
    for (let index = 0; index < chunkLines.length; index += 1) order.push(index)
    order.sort(
        (one, two) =>
            (chunkLines[two] as string).trim().length -
            (chunkLines[one] as string).trim().length,
    )
    for (const index of order) {
        const text = (chunkLines[index] as string).trim()
        if (text.length < 8) return undefined
        const found = output.indexOf(text)
        if (found === -1 || output.indexOf(text, found + 1) !== -1) continue
        const first = lineAt(outputStarts, found) - index
        if (first < 0) continue
        let agreeing = 0
        let written = 0
        for (let at = 0; at < chunkLines.length; at += 1) {
            const lowered = (chunkLines[at] as string).trim()
            if (lowered === '') continue
            written += 1
            if (outputLines[first + at]?.trim() === lowered) agreeing += 1
        }
        if (agreeing * 2 >= written) return first
    }
    return undefined
}

const NAME = /[\w$.]/

// Not the middle of a longer name, or a member of one: `count()` inside `__count()` is not it.
function standsAlone(output: string, start: number, end: number): boolean {
    return (
        !NAME.test(output[start - 1] ?? ' ') &&
        !/[\w$]/.test(output[end] ?? ' ')
    )
}

function lineStarts(text: string): number[] {
    const starts = [0]
    for (
        let at = text.indexOf('\n');
        at !== -1;
        at = text.indexOf('\n', at + 1)
    )
        starts.push(at + 1)
    return starts
}

function lineAt(starts: readonly number[], offset: number): number {
    let low = 0
    let high = starts.length - 1
    while (low < high) {
        const middle = (low + high + 1) >>> 1
        if ((starts[middle] as number) <= offset) low = middle
        else high = middle - 1
    }
    return low
}
