/*
Surface-weight model for the kitchen-sink page tree. A slug's weight estimates its
teaching surface; the band derived from it decides page shape (share / single page /
multi-page section). Construct counts are EXTRACTED from the parser's own sources so
they self-update; only the thresholds and the slug→bucket attribution are declared.
Tooling module (not library public surface), so multiple exports are intentional.
*/

// Band thresholds — the only "how big is too big" policy. Tune here.
export const LIGHT_MAX = 2
export const HEAVY_MIN = 7
export const LINE_BACKSTOP = 250

/* Which grammar buckets each slug owns. The two grammar-bearing slugs only; an
   export-backed slug with no grammar needs no entry. Bucket names double as the
   subpage seams when the slug bands heavy. */
export const SLUG_GRAMMAR: Record<string, string[]> = {
    templating: ['control-flow', 'bindings', 'snippets'],
    'reactive-state': ['primitives'],
}

/* Pulls every single-quoted string from the BLOCK_KEYWORDS array literal. */
export function extractBlockKeywords(source: string): string[] {
    const body = source.match(/BLOCK_KEYWORDS\s*=\s*\[([^\]]*)\]/s)?.[1] ?? ''
    return [...body.matchAll(/'([^']+)'/g)].map((match) => match[1])
}

/* TemplateAttr union member kinds, minus `static` (a literal attribute, not a
   reactive binding/directive). */
export function extractTemplateAttrKinds(source: string): string[] {
    return [...source.matchAll(/\|\s*\{\s*kind:\s*'([a-z]+)'/g)]
        .map((match) => match[1])
        .filter((kind) => kind !== 'static')
}

/* Members of the REACTIVE_CALLEES `new Set([...])` literal. */
export function extractReactiveCallees(source: string): string[] {
    const body = source.match(/new Set\(\[([^\]]*)\]/s)?.[1] ?? ''
    return [...body.matchAll(/'([^']+)'/g)].map((match) => match[1])
}

/* The template-composition node kinds (snippet / component) from the TemplateNode
   union — distinct, since each appears more than once across the type. */
export function extractCompositionKinds(source: string): string[] {
    const kinds = [...source.matchAll(/kind:\s*'(snippet|component)'/g)].map((match) => match[1])
    return [...new Set(kinds)]
}

/* Bucket name → the parser source file (relative to src/lib/ui/compile/) and its
   member extractor. */
export const GRAMMAR_BUCKETS: Record<
    string,
    { file: string; extract: (source: string) => string[] }
> = {
    'control-flow': { file: 'structuralBlockTokens.ts', extract: extractBlockKeywords },
    bindings: { file: 'types/TemplateAttr.ts', extract: extractTemplateAttrKinds },
    snippets: { file: 'types/TemplateNode.ts', extract: extractCompositionKinds },
    primitives: { file: 'REACTIVE_CALLEES.ts', extract: extractReactiveCallees },
}

/* The band a slug lands in: heavy if its weight crosses HEAVY_MIN or its page
   trips the line backstop; light at/below LIGHT_MAX; medium between. */
export function bandFor(weight: number, lineCount = 0): 'light' | 'medium' | 'heavy' {
    if (weight >= HEAVY_MIN || lineCount > LINE_BACKSTOP) {
        return 'heavy'
    }
    if (weight <= LIGHT_MAX) {
        return 'light'
    }
    return 'medium'
}
