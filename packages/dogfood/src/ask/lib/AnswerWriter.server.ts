import { url, type RouteLiteral } from '@abide/abide'

import type { AnswerPart, Show } from './AnswerPart.ts'

// A `<show …/>` line: the kind, its value, and a `code` line's optional `from`.
const SHOW =
    /^<show\s+(example|code|name|clause|results|page|open)="([^"]*)"(?:\s+from="([^"]*)")?\s*\/?>\s*$/
const FENCE = /^(`{3,}|~{3,})\s*([\w+-]*)/

// Only a link to a page of the site, an anchor, or the web; anything else is written as no link.
const UNSAFE_HREF = /href="(?!https?:|\/|#|mailto:)[^"]*"/g
const SITE_HREF = /href="(\/[^"]*)"/g

/** Markdown as HTML: no raw markup from the model, and no address but the web's and the site's. */
function htmlOf(markdown: string): string {
    return Bun.markdown
        .html(markdown, { noHtmlBlocks: true, noHtmlSpans: true, autolinks: true })
        .replace(UNSAFE_HREF, 'href="#"')
        .replace(SITE_HREF, (_whole, path: string) => `href="${url(path as RouteLiteral)}"`)
}

/**
 * THE ANSWER CUT INTO BLOCKS AS IT ARRIVES. A block is final once the line after it is written — a
 * blank line ends prose, a closing fence ends code, and a `<show/>` is a block of its own — so each is
 * rendered ONCE, and only the block still being written is rendered again per delta. Rendering the
 * whole answer per delta would be a full re-render of everything so far on every chunk: O(n²) over a
 * stream.
 */
export class AnswerWriter {
    text = ''
    private line = ''
    private prose: string[] = []
    private fence: { marker: string; language: string; lines: string[] } | undefined =
        undefined

    /** Takes a delta of the answer; answers the blocks it finished, and the one still open. */
    write(delta: string): { parts: AnswerPart[]; tail: AnswerPart | undefined } {
        this.text += delta
        const parts: AnswerPart[] = []
        const lines = (this.line + delta).split('\n')
        this.line = lines.pop() ?? ''
        for (const line of lines) this.take(line, parts)
        return { parts, tail: this.tail() }
    }

    /** The blocks still open once the answer has ended. */
    end(): AnswerPart[] {
        const parts: AnswerPart[] = []
        if (this.line !== '') this.take(this.line, parts)
        this.line = ''
        if (this.fence !== undefined) {
            parts.push(this.code(this.fence))
            this.fence = undefined
        }
        this.flush(parts)
        return parts
    }

    private take(line: string, parts: AnswerPart[]): void {
        if (this.fence !== undefined) {
            if (line.trimStart().startsWith(this.fence.marker)) {
                parts.push(this.code(this.fence))
                this.fence = undefined
            } else this.fence.lines.push(line)
            return
        }
        const fence = FENCE.exec(line.trimStart())
        if (fence) {
            this.flush(parts)
            this.fence = { marker: fence[1] ?? '```', language: fence[2] ?? '', lines: [] }
            return
        }
        const show = SHOW.exec(line.trim())
        if (show) {
            this.flush(parts)
            parts.push({ kind: 'show', show: showOf(show) })
            return
        }
        if (line.trim() === '') {
            this.flush(parts)
            return
        }
        this.prose.push(line)
    }

    private flush(parts: AnswerPart[]): void {
        if (this.prose.length === 0) return
        parts.push({ kind: 'html', html: htmlOf(this.prose.join('\n')) })
        this.prose = []
    }

    private code(fence: { language: string; lines: string[] }): AnswerPart {
        return { kind: 'code', language: fence.language, code: fence.lines.join('\n') }
    }

    private tail(): AnswerPart | undefined {
        if (this.fence !== undefined)
            return this.code({
                language: this.fence.language,
                lines: [...this.fence.lines, this.line],
            })
        const open = [...this.prose, this.line].join('\n').trim()
        // A line that may yet be a `<show/>` is not shown as prose while it is written.
        if (open === '' || this.line.trimStart().startsWith('<show')) return undefined
        return { kind: 'html', html: htmlOf(open) }
    }
}

function showOf(match: RegExpExecArray): Show {
    const kind = match[1] as Show['kind']
    const value = match[2] ?? ''
    return kind === 'code'
        ? { kind, value, from: match[3] }
        : ({ kind, value } as Show)
}
