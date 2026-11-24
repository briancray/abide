// 52.17, 52.18, 52.43 — MARKDOWN RENDERED INCREMENTALLY, as sections an app renders itself: a section a
// stream has moved past is the SAME OBJECT on every later read, so `{#for section of sections by
// section}` keeps its nodes and a chunk re-renders only the section still growing.

import { type Live, live } from '../live.ts'
import { memo } from '../reactive/index.ts'
import {
    blockOf,
    type LinkTarget,
    referencesOf,
    renderSection,
    SCHEMES,
    sectionEnd,
    type Settings,
    settled,
} from './sections.ts'

/** One section of a document: its markup, or the fenced block an app renders in its place. */
export type MarkdownSection = {
    /** The section as markup safe to hand `raw`. `''` where it is a block. */
    readonly html: string
    /** 52.43 — the block the section is, by the first word of its fence's info, its source and the rest of its info. */
    readonly block: { name: string; source: string; info: string } | undefined
}

type Section = MarkdownSection & { readonly source: string }

/** The sections `source` renders as, kept across every change that only adds to its end. */
export function markdownIncremental(options: {
    /** The markdown to render, as it stands: a stream hands it the text so far. */
    source: Live<string>
    /** As `markdown` takes it. */
    schemes?: Live<readonly string[] | undefined>
    /** As `markdown` takes it. */
    headingLevel?: Live<number | undefined>
    /** As `markdown` takes it (52.40). A new function renders every section again. */
    href?: (address: string) => string | LinkTarget | undefined
    /** 52.43 — the first words of a fence's info whose block the app renders, as a section's `block`. */
    blocks?: Live<readonly string[] | undefined>
    /** 52.50 — as `markdown` takes it. */
    streaming?: Live<boolean | undefined>
}): { readonly sections: readonly MarkdownSection[] } {
    // The sections no later text can change, the source and settings they were rendered from, and
    // the section still growing as the last text left it.
    let closed: Section[] = []
    let closedSource = ''
    let closedSettings: Settings | undefined
    let closedBlocks = ''
    let open: Section | undefined

    // The section `text` renders as — the growing one itself where it closed as the last text left
    // it. 52.43 — `blockOf` answers nothing for a fence still open, so a block still being written
    // renders as code.
    function sectionOf(
        text: string,
        settings: Settings,
        names: readonly string[],
    ): Section {
        // 52.18 — a section closing as it stood keeps the nodes it rendered while open.
        if (open?.source === text) return open
        const found = names.length === 0 ? undefined : blockOf(text, names)
        if (found === undefined)
            return {
                source: text,
                html: renderSection(text, settings),
                block: undefined,
            }
        // And a block the text ended on is the same block once text goes on past it, the blank line
        // after its fence joining the section.
        const held = open?.block
        if (
            held !== undefined &&
            held.name === found.name &&
            held.source === found.source &&
            held.info === found.info
        )
            return open as Section
        return {
            source: text,
            html: '',
            block: { name: found.name, source: found.source, info: found.info },
        }
    }

    const sections = memo((): readonly MarkdownSection[] => {
        const text = live(options.source) ?? ''
        const names = live(options.blocks) ?? []
        const settings: Settings = {
            schemes: live(options.schemes) ?? SCHEMES,
            headingLevel: live(options.headingLevel) ?? 1,
            href: options.href,
            references: referencesOf(text),
            blocks: {},
        }
        if (
            closedSettings === undefined ||
            closedSettings.schemes.join() !== settings.schemes.join() ||
            closedSettings.headingLevel !== settings.headingLevel ||
            closedSettings.href !== settings.href ||
            closedBlocks !== names.join() ||
            // 52.41 — a definition landing later names links in sections already rendered.
            !sameReferences(closedSettings.references, settings.references) ||
            !text.startsWith(closedSource)
        ) {
            closed = []
            closedSource = ''
            open = undefined
        }
        closedSettings = settings
        closedBlocks = names.join()
        let at = closedSource.length
        let end = sectionEnd(text, at)
        while (end < text.length) {
            closed.push(sectionOf(text.slice(at, end), settings, names))
            at = end
            end = sectionEnd(text, at)
        }
        closedSource = text.slice(0, at)
        const shown: Section[] = closed.slice()
        if (at < text.length) {
            const growing = text.slice(at)
            open = sectionOf(
                live(options.streaming) === true ? settled(growing) : growing,
                settings,
                names,
            )
            shown.push(open)
        }
        return shown
    })

    return {
        get sections() {
            return sections()
        },
    }
}

function sameReferences(
    held: ReadonlyMap<string, string>,
    now: ReadonlyMap<string, string>,
): boolean {
    if (held.size !== now.size) return false
    for (const [label, url] of now) if (held.get(label) !== url) return false
    return true
}
