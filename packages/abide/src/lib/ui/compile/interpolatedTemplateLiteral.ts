import type { TextPart } from './types/TextPart.ts'

/* Escapes a literal attribute chunk for embedding in a JS template literal: a
   backslash, backtick, or `${` would otherwise start an escape/expression. */
function escapeTemplateChunk(value: string): string {
    return value.replace(/[\\`]/g, '\\$&').replace(/\$\{/g, '\\${')
}

/*
Builds the RAW (un-lowered) template-literal source for an interpolated attribute
or prop value — static parts escaped, each `{expr}` spliced as `${code}`. The caller
lowers the whole result through its signal transformer, so the embedded expressions
are rewritten exactly like any other template expression. Both back-ends and the
component-prop path share this one builder, so server markup, client binding, and
prop value can't diverge on the concatenation. Always yields a string, so an
interpolated attribute is always present.
*/
export function interpolatedTemplateLiteral(parts: TextPart[]): string {
    const body = parts
        .map((part) =>
            part.kind === 'static' ? escapeTemplateChunk(part.value) : `\${${part.code}}`,
        )
        .join('')
    return `\`${body}\``
}
