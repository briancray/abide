// A SNIPPET is a slice of a real example file, addressed by an ANCHOR. `{% snippet %}`
// is what a page writes instead of pasting code into a fence: the documentation shows
// only lines that exist on disk, so a sample cannot drift from the app it describes and
// a stale one is a BUILD FAILURE rather than a reader's problem.
//
// The anchor is a line PREFIX that must match exactly once. From that line the slice
// runs to the end of the construct it opens — which is the whole rule, applied by two
// balancers because markup and code close differently and nothing else does.

import { escapeAttribute } from 'abide'

// A BUILD SCRIPT, NOT APP CODE: it balances markup by the compiler's own void list, and exporting
// that list to reach it would make it public surface.
import { VOID_ELEMENTS } from '../../abide/src/compiler/VOID_ELEMENTS.ts'
import { readManifest, readSource } from './renderExample.ts'
import { displayPath, highlight, sideOf } from './renderMarkdown.ts'

export type SnippetAddress = { example: string; file: string; anchor: string }

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
 * Depth after one line of code, skipping brackets that are inside a string or a comment.
 *
 * A template literal's `${…}` nests, so the quote arm counts brackets rather than swallowing to
 * the closing backtick.
 */
function bracketDepthOf(line: string, depth: number): number {
    let quote = ''
    for (let index = 0; index < line.length; index += 1) {
        const char = line[index]
        if (quote) {
            if (char === '\\') index += 1
            else if (char === quote) quote = ''
            else if (quote === '`' && char === '{' && line[index - 1] === '$')
                depth += 1
            else if (quote === '`' && char === '}') depth -= 1
            continue
        }
        if (char === '/' && line[index + 1] === '/') break
        if (char === "'" || char === '"' || char === '`') quote = char
        else if (char === '(' || char === '[' || char === '{') depth += 1
        else if (char === ')' || char === ']' || char === '}') depth -= 1
    }
    return depth
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
    let end = start
    for (; end < lines.length; end += 1) {
        const line = lines[end] ?? ''
        depth = markup ? depth + tagDepthOf(line) : bracketDepthOf(line, depth)
        if (depth <= 0) break
    }
    return [start, Math.min(end, lines.length - 1)]
}

/**
 * The separator between a snippet's anchors, and between their runs in its fence.
 *
 * SEVERAL ANCHORS, one fence. A section's claim is often two lines that are not one construct — a
 * declaration and the markup that reads it — and showing them as two captioned blocks reads as
 * two subjects. `…` is the separator because it is the mark that goes BETWEEN the runs in the
 * output too, and because no line of code contains one.
 */
export const ELISION = ' … '

/** The dedented lines each anchor addresses, in file order, with a `…` line over each gap. */
export function slice(source: string, anchor: string, where: string): string {
    const lines = source.split('\n')
    const runs: [number, number][] = []
    for (const one of anchor.split(ELISION))
        runs.push(runOf(lines, one.trim(), where))
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

/** The slice a snippet address names, refused unless the file is one of its example's. */
async function readSlice(address: SnippetAddress): Promise<string> {
    const { example, file, anchor } = address
    // A SNIPPET QUOTES AN EXAMPLE, not the app at large: the file has to be one the example is
    // made of, or the page shows code no card on it runs.
    if (!(await readManifest(example)).files.includes(file))
        throw new Error(`snippet ${example}: ${file} is not one of its files`)
    const source = await readSource(file)
    if (source === undefined)
        throw new Error(`snippet ${example}: ${file} is missing`)
    if (!anchor) return source.trimEnd()
    return slice(source, anchor, `snippet ${example} ${file}`)
}

/**
 * The snippet's caption: its file as an author imports it, marked as an excerpt when anchored.
 *
 * The caption, the language and the SPINE are all derived from the address — an author names a
 * file and a line, never a color or a suffix, so a snippet cannot claim a seam its path
 * contradicts. An anchored slice is partial BY CONSTRUCTION, so it says so.
 */
function captionOf(address: SnippetAddress): string {
    return displayPath(
        address.anchor ? `${address.file} — excerpt` : address.file,
    )
}

/** The snippet as a captioned, highlighted `<figure>` for the site. */
export async function snippetHtml(address: SnippetAddress): Promise<string> {
    const code = await readSlice(address)
    return `<figure class="snippet" data-side="${sideOf(address.file)}">
<figcaption>${escapeAttribute(captionOf(address))}</figcaption><pre><code>${highlight(code)}</code></pre></figure>`
}

/** The snippet as a captioned fence for the markdown twin. */
export async function snippetMarkdown(
    address: SnippetAddress,
): Promise<string> {
    const code = await readSlice(address)
    const language = address.file.slice(address.file.lastIndexOf('.') + 1)
    return `\`\`\`${language} ${captionOf(address)}\n${code}\n\`\`\``
}
