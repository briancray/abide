/**
 * Every control block the template parser reads (`parseAbide`), and the arms each one takes.
 *
 * 38.117 — what `abide lsp` offers after `{#`, `{:` and `{/`; `templateContext.test.ts` holds the
 * parser to the same list.
 */
export const TEMPLATE_BLOCKS: Readonly<Record<string, readonly string[]>> = {
    if: ['else', 'else if'],
    for: [],
    try: ['catch', 'finally'],
    component: [],
}
