/* The regex that isolates a `.abide` file's leading `<script>` block, capturing its body (`[1]`) —
   the single source `analyzeComponent`, `compileShadow`, and `templateStartOffset` all match on to
   split script from template, so the three can never drift. Stateless (no `/g`), safe to share. */
export const LEADING_SCRIPT = /^\s*<script[^>]*>([\s\S]*?)<\/script>/

/*
The source offset where the template markup begins — just past the closing `</script>` of a
leading `<script>` block, or `0` when the file is template-only. A component's template
interpolations all map to source offsets at or after this point, so it doubles as the boundary
that separates template expressions from `<script>` code.
*/
export function templateStartOffset(source: string): number {
    const leadingScript = source.match(LEADING_SCRIPT)
    return leadingScript ? (leadingScript.index ?? 0) + leadingScript[0].length : 0
}
