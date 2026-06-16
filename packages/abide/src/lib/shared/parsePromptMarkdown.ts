import type { PromptArgument } from './types/PromptArgument.ts'

export type ParsedPromptMarkdown = {
    description: string | undefined
    arguments: PromptArgument[]
    body: string
}

// Leading YAML frontmatter block fenced by `---` lines (CRLF tolerant).
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

/*
Splits a `src/mcp/prompts/**.md` file into its frontmatter metadata and
template body. The frontmatter (optional) carries `description` and an
`arguments` list; everything after the closing `---` is the prompt body,
interpolated at render time via `{{name}}` placeholders. A file with no
frontmatter is all body. Parsed with Bun.YAML — the resolver plugin runs
under Bun, so the native parser is always available at build time.
*/
export function parsePromptMarkdown(source: string): ParsedPromptMarkdown {
    const match = FRONTMATTER.exec(source)
    if (!match) {
        return { description: undefined, arguments: [], body: source.trim() }
    }
    // The pattern makes group 1 mandatory; the '' default exists for noUncheckedIndexedAccess in consumer tsconfigs.
    const frontmatter = (Bun.YAML.parse(match[1] ?? '') ?? {}) as {
        description?: string
        arguments?: PromptArgument[]
    }
    return {
        description: frontmatter.description,
        arguments: Array.isArray(frontmatter.arguments) ? frontmatter.arguments : [],
        body: source.slice(match[0].length).trim(),
    }
}
