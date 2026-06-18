import type { Parser } from 'prettier'

/*
The `.abide` parser. Formatting is a whole-file mask/reflow/restore pass (see
formatAbideSource), not an AST walk, so `parse` just wraps the source in a single
node the printer's `embed` hook formats. `locStart`/`locEnd` span the whole file.
*/
export const abideParser: Parser = {
    astFormat: 'abide-ast',
    locStart: () => 0,
    locEnd: (node) => node.text.length,
    parse: (text) => ({ type: 'abide-file', text }),
}
