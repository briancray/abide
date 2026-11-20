import {
    inline,
    type LinkTarget,
    referencesOf,
    render,
    SCHEMES,
} from './sections.ts'

/**
 * Markdown as HTML that is safe to render as markup: paragraphs, headings, emphasis, code, fenced
 * code, lists, quotes, rules, tables and links, with every other character escaped. Hand what it
 * answers to `raw`.
 */
export function markdown(
    text: string,
    options: {
        /**
         * The schemes a link's address may have, lowercase and without the colon. A link to any
         * other renders as its text, and an address with no scheme is a path on this origin.
         * `['http', 'https', 'mailto']` by default.
         */
        schemes?: readonly string[]
        /** The level a `#` heading renders at, the deeper ones below it, down to 6. 1 by default. */
        headingLevel?: number
        /**
         * Where each link `schemes` lets through goes: an address — a path under the app's mount,
         * say — or the address with the `target` and `rel` it opens with (52.40). A link it answers
         * `undefined` for renders as its text.
         */
        href?: (address: string) => string | LinkTarget | undefined
        /**
         * 52.42 — the fenced blocks rendered by the caller, by the first word of the fence's info:
         * each is handed the block's source and the rest of the info, and answers its markup, which is
         * written as it is.
         */
        blocks?: Readonly<
            Record<string, (source: string, info: string) => string>
        >
        /** Whether `text` is one line of inline marks — a title, a table cell — with no paragraph around it. */
        inline?: boolean
    } = {},
): string {
    const settings = {
        schemes: options.schemes ?? SCHEMES,
        headingLevel: options.headingLevel ?? 1,
        href: options.href,
        references: referencesOf(text),
        blocks: options.blocks ?? {},
    }
    return options.inline === true
        ? inline(text, settings, false)
        : render(text, settings)
}
