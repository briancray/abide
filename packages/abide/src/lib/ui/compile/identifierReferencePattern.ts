import { escapeRegex } from '../../shared/escapeRegex.ts'

/*
A RegExp that matches `name` used as a whole identifier in a body of code.
Boundaries are `(?<![$\w]) … (?![$\w])`, NOT `\b`: `\b` never fires before a
`$`-leading identifier (`$` is a non-word char, so there's no word boundary
before it), so `\b$e\b` silently matches nothing — the exact miss that made an
aliased reactive import (`import { effect as $e }`) read as dead. The name is
regex-escaped so a `$` or other metachar in it is literal, not an anchor.
*/
export function identifierReferencePattern(name: string): RegExp {
    return new RegExp(`(?<![$\\w])${escapeRegex(name)}(?![$\\w])`)
}
