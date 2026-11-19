// A SLICE of a real file, addressed by an ANCHOR: how a page shows its Tests and an answer shows a
// file of the CRM, so a case cannot drift from the file it quotes and a stale anchor throws where the
// page renders (40.18).
//
// The anchor is a line PREFIX that must match exactly once. From that line the slice runs to the
// end of the construct it opens — which is the whole rule, applied by two balancers because markup
// and code close differently and nothing else does.

import { VOID_ELEMENTS } from './VOID_ELEMENTS.ts'

const TAG = /<\/?([a-zA-Z][\w-]*)|\/>/g

/**
 * Depth after one line of markup.
 *
 * `<input …>` is void so it nets zero, `<select …>` opens one, `</select>` closes it, and
 * `<Stepper …/>` closes itself.
 */
function tagDepthOf(line: string): number {
    let depth = 0
    TAG.lastIndex = 0
    for (let match = TAG.exec(line); match; match = TAG.exec(line)) {
        if (match[0] === '/>') {
            depth -= 1
            continue
        }
        const name = match[1] ?? ''
        if (VOID_ELEMENTS.has(name.toLowerCase())) continue
        depth += match[0].startsWith('</') ? -1 : 1
    }
    return depth
}

/**
 * Where a scan of code stands at the end of a line: the bracket depth, the template literals and
 * their `${…}` interpolations open around it, and whether a block comment is.
 *
 * CARRIED ACROSS LINES, because a template literal and a block comment both span them: read line by
 * line, a backtick on one line closed nothing the line before opened, and a `}` in a literal's text
 * read as code ended the construct early.
 */
type CodeScan = {
    depth: number
    /** Innermost last: a template literal, or an interpolation counting its own open braces. */
    open: ({ kind: 'template' } | { kind: 'interpolation'; braces: number })[]
    comment: boolean
}

/** Advances `scan` over one line of code, skipping what is inside a string or a comment. */
function scanCode(line: string, scan: CodeScan): void {
    let quote = ''
    for (let index = 0; index < line.length; index += 1) {
        const char = line[index]
        if (scan.comment) {
            if (char === '*' && line[index + 1] === '/') {
                scan.comment = false
                index += 1
            }
            continue
        }
        const inner = scan.open.at(-1)
        if (inner?.kind === 'template') {
            if (char === '\\') index += 1
            else if (char === '`') scan.open.pop()
            else if (char === '$' && line[index + 1] === '{') {
                scan.open.push({ kind: 'interpolation', braces: 0 })
                index += 1
            }
            continue
        }
        if (quote) {
            if (char === '\\') index += 1
            else if (char === quote) quote = ''
            continue
        }
        if (char === '/' && line[index + 1] === '/') break
        if (char === '/' && line[index + 1] === '*') {
            scan.comment = true
            index += 1
        } else if (char === "'" || char === '"') quote = char
        else if (char === '`') scan.open.push({ kind: 'template' })
        else if (inner?.kind === 'interpolation' && char === '{')
            inner.braces += 1
        else if (inner?.kind === 'interpolation' && char === '}') {
            if (inner.braces === 0) scan.open.pop()
            else inner.braces -= 1
        } else if (char === '(' || char === '[' || char === '{') scan.depth += 1
        else if (char === ')' || char === ']' || char === '}') scan.depth -= 1
    }
}

function dedent(lines: string[]): string {
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

/**
 * The first and last line of the construct the one line starting with `anchor` opens.
 *
 * EXACTLY ONE match is the contract, and both ways of missing it are errors worth telling apart:
 * none means the code moved, two means the anchor stopped identifying anything. Either way the
 * page is making a claim the file no longer supports.
 */
function runOf(
    lines: string[],
    anchor: string,
    where: string,
): [number, number] {
    const starts: number[] = []
    for (let index = 0; index < lines.length; index += 1) {
        if ((lines[index] ?? '').trimStart().startsWith(anchor))
            starts.push(index)
    }
    if (starts.length === 0)
        throw new Error(`${where}: no line starts with ${anchor}`)
    if (starts.length > 1)
        throw new Error(
            `${where}: ${anchor} matches ${starts.length} lines (${starts.map((n) => n + 1).join(', ')}); lengthen it`,
        )

    const start = starts[0] ?? 0
    const markup = (lines[start] ?? '').trimStart().startsWith('<')
    let depth = 0
    const scan: CodeScan = { depth: 0, open: [], comment: false }
    let end = start
    for (; end < lines.length; end += 1) {
        const line = lines[end] ?? ''
        if (markup) depth += tagDepthOf(line)
        else {
            scanCode(line, scan)
            depth = scan.depth
        }
        if (depth <= 0 && scan.open.length === 0 && !scan.comment) break
    }
    return [start, Math.min(end, lines.length - 1)]
}

/**
 * The dedented lines each anchor addresses, in file order, with a `…` line over each gap.
 *
 * SEVERAL ANCHORS, one fence. A section's claim is often two lines that are not one construct — a
 * declaration and the markup that reads it — and showing them as two captioned blocks reads as two
 * subjects.
 */
export function slice(
    source: string,
    anchors: readonly string[],
    where: string,
): string {
    const lines = source.split('\n')
    const runs: [number, number][] = []
    for (const anchor of anchors) runs.push(runOf(lines, anchor, where))
    runs.sort((a, b) => a[0] - b[0])

    const out: string[] = []
    let previousEnd = -1
    for (const [start, end] of runs) {
        // Contiguous runs join as they lie; a gap is SHOWN, because a snippet that closes
        // a gap silently is a claim the file reads the way the page printed it.
        if (previousEnd !== -1 && start > previousEnd + 1) {
            const indent = (lines[start] ?? '').search(/\S|$/)
            out.push(`${(lines[start] ?? '').slice(0, indent)}…`)
        }
        for (
            let index = Math.max(start, previousEnd + 1);
            index <= end;
            index += 1
        ) {
            out.push(lines[index] ?? '')
        }
        previousEnd = Math.max(previousEnd, end)
    }
    return dedent(out).trimEnd()
}
