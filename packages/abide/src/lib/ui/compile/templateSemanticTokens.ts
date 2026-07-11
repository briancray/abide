import { parseTemplateRecovering } from './parseTemplateRecovering.ts'
import type { SemanticToken } from './types/SemanticToken.ts'

/*
The LSP's markup + structural highlighting for a full `.abide` component, driven by
the ONE parse walk (`parseTemplateRecovering`) instead of a pair of hand-rolled
lexers — so the same grammar that builds the tree colors it, and no coloring can
drift from what the parser accepts. Runs over the FULL source at `baseOffset 0` with
token collection on: element/component tag names (`tag`/`type`), attribute names
(`attribute`), quoted/unquoted values (`string`), comments (`comment`), the
`<`/`>`/`=`/`/` punctuation (`operator`), and the `{#…}`/`{:…}`/`{/…}` block framing
(`operator` + `keyword`). The leading `<script>…</script>` reads through the same
`readElement` path as a nested script, so its open+close tags color with no separate
leading-region lexer. `{…}` expression interiors and raw `<script>`/`<style>` bodies
are skipped — those are the type-checking shadow's job. The parse's `nodes` and
`diagnostics` (including the spurious leading-script diagnostics a full-source parse
raises) are discarded; only `.tokens` is used.
*/
export function templateSemanticTokens(source: string): SemanticToken[] {
    return parseTemplateRecovering(source, 0, true).tokens
}
