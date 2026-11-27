// 38.199 — THE CODE A FILE HOLDS, found for a migration to rewrite: a module is all code, an `.abide`
// file's script blocks are, and a code sample — a Markdown fence, or a template literal a module or
// a page's markup hands on — is a file of its own, shown rather than run, and rewritten as the
// grammar it is written in.

import { SyntaxKind } from 'typescript/unstable/ast'

import { tokenize } from './tokenize.ts'

/** Which grammar `text` is: a TypeScript module, an `.abide` file, or Markdown with code fences. */
type Kind = 'ts' | 'abide' | 'md'

/** One migration's rewrite of the code it finds. */
export type CodeRewrite = {
    /** A word every file the rewrite changes holds, so a file without it is skipped unread. */
    word: string
    /** A module, rewritten. */
    module: (code: string) => string
    /**
     * An `.abide` file's script blocks in order, each rewritten — handed together, since a page's
     * nested per-arm `<script>` reads what its top-level one imports. Each block as a `module` where
     * it is not given.
     */
    scripts?: ((blocks: string[]) => string[]) | undefined
}

/** `text`, a file at `path`, with the code in it rewritten by `rewrite`. */
export function rewriteCode(
    text: string,
    path: string,
    rewrite: CodeRewrite,
): string {
    const kind: Kind = path.endsWith('.abide')
        ? 'abide'
        : path.endsWith('.md')
          ? 'md'
          : 'ts'
    return rewritten(text, kind, rewrite)
}

/** An `.abide` file's script block: its open tag, its code and its close tag. */
export const SCRIPT = /(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi

/** One replacement a migration makes in a piece of code: `start` to `end` becomes `text`. */
export type Splice = { start: number; end: number; text: string }

/** `code` with every one of `splices` made, none overlapping, in whatever order they were found. */
export function spliced(code: string, splices: Splice[]): string {
    splices.sort((left, right) => left.start - right.start)
    let out = code
    for (let index = splices.length - 1; index >= 0; index -= 1) {
        const splice = splices[index] as Splice
        out = `${out.slice(0, splice.start)}${splice.text}${out.slice(splice.end)}`
    }
    return out
}

/** Where `at`, an offset in the code `splices` were made over, stands in what they made of it. */
export function splicedOffset(at: number, splices: readonly Splice[]): number {
    let moved = at
    for (const splice of splices)
        if (splice.end <= at)
            moved += splice.text.length - (splice.end - splice.start)
    return moved
}

/** The whole line of `text` that `at` stands on. */
export function lineAround(text: string, at: number): string {
    const start = text.lastIndexOf('\n', at - 1) + 1
    const end = text.indexOf('\n', at)
    return text.slice(start, end === -1 ? undefined : end)
}

function rewritten(text: string, kind: Kind, rewrite: CodeRewrite): string {
    if (!text.includes(rewrite.word)) return text
    if (kind === 'ts') return samplesInModule(rewrite.module(text), rewrite)
    if (kind === 'md')
        return replaceSpans(
            text,
            /^([ \t]*)(```|~~~)([\w-]*)[^\n]*\n([\s\S]*?)^\1\2[ \t]*$/gm,
            4,
            rewrite,
        )
    // An `.abide` file: its script blocks are modules, and a code sample written in its markup — a
    // template literal handed to a prop — is a file of its own.
    const matches = [...text.matchAll(new RegExp(SCRIPT.source, 'gdi'))]
    const found = matches.map((match) => match[2] as string)
    const blocks =
        rewrite.scripts?.(found) ?? found.map((block) => rewrite.module(block))
    let out = ''
    let last = 0
    for (let index = 0; index < matches.length; index += 1) {
        const match = matches[index] as RegExpExecArray
        const [start, end] = match.indices?.[2] as [number, number]
        out += samplesInMarkup(text.slice(last, match.index), rewrite)
        out += text.slice(match.index, start)
        out += samplesInModule(blocks[index] as string, rewrite)
        last = end
    }
    return out + samplesInMarkup(text.slice(last), rewrite)
}

/** The grammar a sample is written in: a page where it holds a `<script>`, a module otherwise. */
function kindOf(sample: string): Kind {
    return sample.includes('<script') ? 'abide' : 'ts'
}

/** Each match's group `group` rewritten as the grammar it reads as, the rest kept. */
function replaceSpans(
    text: string,
    pattern: RegExp,
    group: number,
    rewrite: CodeRewrite,
): string {
    let out = ''
    let last = 0
    const indexed = new RegExp(pattern.source, `${pattern.flags}d`)
    for (const match of text.matchAll(indexed)) {
        const inner = match[group] ?? ''
        const start = match.indices?.[group]?.[0] ?? match.index ?? 0
        out += text.slice(last, start)
        out += rewritten(inner, kindOf(inner), rewrite)
        last = start + inner.length
    }
    return out + text.slice(last)
}

/** `markup` with each backtick-delimited sample in it rewritten. */
function samplesInMarkup(markup: string, rewrite: CodeRewrite): string {
    return replaceSpans(markup, /`((?:\\[\s\S]|[^`\\])*)`/g, 1, rewrite)
}

/** The template literals a module holds — a code sample a docs page shows — each rewritten. */
function samplesInModule(text: string, rewrite: CodeRewrite): string {
    if (!new RegExp(`\`[^\`]*${rewrite.word}`).test(text)) return text
    let out = ''
    let last = 0
    for (const token of tokenize(text)) {
        if (
            token.kind !== SyntaxKind.NoSubstitutionTemplateLiteral ||
            !token.text.includes(rewrite.word)
        )
            continue
        const inner = token.text.slice(1, -1)
        out += text.slice(last, token.start + 1)
        out += rewritten(inner, kindOf(inner), rewrite)
        last = token.end - 1
    }
    return out + text.slice(last)
}
