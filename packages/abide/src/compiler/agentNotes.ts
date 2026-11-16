// 38.195-38.197, 38.202, 38.203 — WHAT AN APP'S `AGENTS.md` RESTATES OF ABIDE. Every abide fact an agent needs
// ships in the package's `ABIDE.md` and updates with it; a copy in the app's own notes is a second
// statement that stops being true one release later. A paragraph counts only where it is WORD FOR
// WORD one `ABIDE.md` holds or one an earlier scaffold wrote — the app's own rewording of a fact is
// its own text, and nothing here guesses at it.

import { ABIDE_DIRECTORY } from '#server/ABIDE_DIRECTORY.ts'

import { type Diagnosis, diagnosisAt } from './Diagnostics.ts'

/** One paragraph of a markdown file, over the lines `[start, end)`, its text whitespace-collapsed. */
type Paragraph = { start: number; end: number; text: string; heading: boolean }

const OPENS_PARAGRAPH = /^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s)/
const FENCE = /^\s*(?:```|~~~)/

/**
 * 38.197 — the paragraphs of `lines`: a heading line, a list item with the lines under it, a fenced
 * block, or a run of lines between blank lines.
 */
export function paragraphsOf(lines: readonly string[]): Paragraph[] {
    const paragraphs: Paragraph[] = []
    let start = -1
    let fenced = false
    const close = (end: number): void => {
        if (start < 0) return
        let text = ''
        for (let line = start; line < end; line++)
            text += ` ${lines[line] as string}`
        paragraphs.push({
            start,
            end,
            text: text.replace(/\s+/g, ' ').trim(),
            heading: (lines[start] as string).startsWith('#'),
        })
        start = -1
    }
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index] as string
        if (fenced) {
            if (FENCE.test(line)) {
                fenced = false
                close(index + 1)
            }
            continue
        }
        if (FENCE.test(line)) {
            close(index)
            start = index
            fenced = true
            continue
        }
        if (line.trim() === '') {
            close(index)
            continue
        }
        if (OPENS_PARAGRAPH.test(line)) close(index)
        if (start < 0) start = index
        if (line.startsWith('#')) close(index + 1)
    }
    close(lines.length)
    return paragraphs
}

/**
 * What a paragraph restates (38.196), and the paragraph the scaffold's `AGENTS.md` opens with, as its
 * lines and its text — read once from the package running, so the `ABIDE.md` compared against is
 * the one installed.
 */
let owned:
    | Promise<{
          restated: Set<string>
          pointer: { lines: string[]; text: string }
      }>
    | undefined

function ownedByAbide() {
    owned ??= (async () => {
        const restated = new Set<string>()
        for (const file of [
            `${import.meta.dir}/EARLIER_AGENT_NOTES.md`,
            `${ABIDE_DIRECTORY}ABIDE.md`,
        ])
            for (const paragraph of paragraphsOf(
                (await Bun.file(file).text()).split('\n'),
            ))
                if (!paragraph.heading) restated.add(paragraph.text)
        const scaffoldLines = (
            await Bun.file(`${ABIDE_DIRECTORY}scaffold/AGENTS.md`).text()
        ).split('\n')
        let pointer: { lines: string[]; text: string } | undefined
        for (const paragraph of paragraphsOf(scaffoldLines)) {
            restated.delete(paragraph.text)
            if (pointer === undefined && !paragraph.heading)
                pointer = {
                    lines: scaffoldLines.slice(paragraph.start, paragraph.end),
                    text: paragraph.text,
                }
        }
        if (pointer === undefined)
            throw new Error('abide: the scaffold AGENTS.md holds no paragraph')
        return { restated, pointer }
    })()
    return owned
}

/** 38.196 — a warning at each paragraph of `AGENTS.md` under `directory` that restates abide. */
export async function agentNoteFindings(
    directory: string,
): Promise<Diagnosis[]> {
    const file = Bun.file(`${directory}/AGENTS.md`)
    if (!(await file.exists())) return []
    const text = await file.text()
    const lines = text.split('\n')
    const { restated } = await ownedByAbide()
    const found: Diagnosis[] = []
    let offset = 0
    let line = 0
    for (const paragraph of paragraphsOf(lines)) {
        for (; line < paragraph.start; line++)
            offset += (lines[line] as string).length + 1
        if (!paragraph.heading && restated.has(paragraph.text))
            found.push(
                diagnosisAt(
                    file.name as string,
                    text,
                    offset,
                    'warning',
                    'this paragraph restates what the installed `@abide/abide/ABIDE.md` holds, and stops being true as abide changes; `abide upgrade` removes it. RULEBOOK 38.196.',
                ),
            )
    }
    return found
}

/**
 * 38.202, 38.203 — `text` without the paragraphs 38.196 warns at and the headings that leaves empty, opened
 * with the scaffold's pointer to `ABIDE.md` where it lacks one; `text` itself where nothing restates.
 */
export async function withoutRestatedNotes(text: string): Promise<string> {
    const lines = text.split('\n')
    const { restated, pointer } = await ownedByAbide()
    const paragraphs = paragraphsOf(lines)
    const removed = new Set<Paragraph>()
    let holdsPointer = false
    for (const paragraph of paragraphs) {
        if (paragraph.text === pointer.text) holdsPointer = true
        if (!paragraph.heading && restated.has(paragraph.text))
            removed.add(paragraph)
    }
    if (removed.size === 0) return text
    // A HEADING GOES where everything under it went: its section, to the next heading of its level or
    // above, held a paragraph that was removed and holds none that stays. The file's title stays, the
    // pointer going under it.
    const titled = (lines[0] ?? '').startsWith('# ')
    for (let index = 0; index < paragraphs.length; index++) {
        const heading = paragraphs[index] as Paragraph
        if (!heading.heading || heading.start === 0) continue
        const level = headingLevel(lines[heading.start] as string)
        let emptied = false
        let kept = false
        for (let next = index + 1; next < paragraphs.length; next++) {
            const under = paragraphs[next] as Paragraph
            if (
                under.heading &&
                headingLevel(lines[under.start] as string) <= level
            )
                break
            if (removed.has(under)) emptied = true
            else if (!under.heading) kept = true
        }
        if (emptied && !kept) removed.add(heading)
    }
    const dropped = new Set<number>()
    for (const paragraph of removed)
        for (let line = paragraph.start; line < paragraph.end; line++)
            dropped.add(line)
    const kept: string[] = []
    for (let index = 0; index < lines.length; index++) {
        if (dropped.has(index)) continue
        const line = lines[index] as string
        // the blank lines around a removed paragraph close up into one
        if (
            line.trim() === '' &&
            (kept.length === 0 || kept.at(-1)?.trim() === '')
        )
            continue
        kept.push(line)
        if (!holdsPointer && titled && index === 0)
            kept.push('', ...pointer.lines)
    }
    if (!holdsPointer && !titled) kept.unshift(...pointer.lines, '')
    while (kept.length > 0 && (kept.at(-1) as string).trim() === '') kept.pop()
    return `${kept.join('\n')}\n`
}

function headingLevel(line: string): number {
    return (/^#+/.exec(line)?.[0] ?? '').length
}
