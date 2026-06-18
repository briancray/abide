import { format, type Options } from 'prettier'
import { scanRegions } from './scanRegions.ts'
import type { Segment } from './types/Segment.ts'

/*
Formats a whole `.abide` component. The blocker for any HTML formatter is abide's
`{…}` grammar: Prettier's HTML parser errors on `attr={expr}` and mangles `{expr}`
in text. So this masks every expression to an inert token and every `<script>`/
`<style>` to a placeholder element, lets Prettier's mature HTML engine reflow the
markup (indentation, attribute wrapping, inline/block whitespace — the hard part),
then restores the masked spans, each formatted with its own sub-parser. Malformed
markup leaves the file untouched rather than throwing.
*/
export async function formatAbideSource(source: string, options: Options): Promise<string> {
    const segments = scanRegions(source)
    const expressions: string[] = []
    const blocks: Extract<Segment, { kind: 'script' | 'style' }>[] = []
    let masked = ''
    for (const segment of segments) {
        if (segment.kind === 'raw') {
            masked += segment.value
        } else if (segment.kind === 'expr') {
            // A bare alphanumeric token survives the HTML pass intact — in text it
            // stays a word; after `=` Prettier reads it as the attribute value and
            // quotes it, which the attribute-form restore below unwraps.
            masked += expressionToken(expressions.length)
            expressions.push(segment.value)
        } else {
            masked += `<abide-${segment.kind} data-i="${blocks.length}"></abide-${segment.kind}>`
            blocks.push(segment)
        }
    }
    let output: string
    try {
        output = await format(masked, htmlOptions(options))
    } catch {
        return source
    }
    output = await restoreExpressions(output, expressions, options)
    return restoreBlocks(output, blocks, options)
}

/* A unique, regex-safe placeholder for the expression at `index`. The trailing `X`
   keeps one token from being a prefix of another (`…1X` vs `…11X`). */
function expressionToken(index: number): string {
    return `ABIDEEXPR${index}X`
}

/* Restores each masked expression, formatted as a one-line TS expression. A result
   that would wrap is kept as authored rather than spilling a dedented block into the
   markup. The attribute form (`="token"`, quoted by the HTML pass) unwraps to
   `={expr}`; the bare text form becomes `{expr}`. */
async function restoreExpressions(
    output: string,
    expressions: string[],
    options: Options,
): Promise<string> {
    let restored = output
    for (let index = 0; index < expressions.length; index += 1) {
        const code = await formatExpression(expressions[index] as string, options)
        const token = expressionToken(index)
        restored = restored
            .replace(new RegExp(`=(["'])${token}\\1`), `={${code}}`)
            .replace(token, `{${code}}`)
    }
    return restored
}

/* The expression formatted to one line, or the original on failure / multi-line. */
async function formatExpression(code: string, options: Options): Promise<string> {
    try {
        const formatted = (await format(code, expressionOptions(options))).trimEnd()
        return formatted.includes('\n') ? code : formatted
    } catch {
        return code
    }
}

/* Restores each `<script>`/`<style>` placeholder to its formatted block, indented
   to the column the HTML pass placed the placeholder at: the open tag at that
   column, the body and close tag below it, the body's own indentation on top. */
async function restoreBlocks(
    output: string,
    blocks: Extract<Segment, { kind: 'script' | 'style' }>[],
    options: Options,
): Promise<string> {
    let restored = output
    for (let index = 0; index < blocks.length; index += 1) {
        const block = blocks[index] as Extract<Segment, { kind: 'script' | 'style' }>
        const parser = block.kind === 'script' ? 'typescript' : 'css'
        const body = await formatBlockBody(block.body, parser, options)
        const placeholder = new RegExp(
            `^([ \\t]*)<abide-${block.kind} data-i="${index}"></abide-${block.kind}>`,
            'm',
        )
        const match = restored.match(placeholder)
        const pad = match?.[1] ?? ''
        const indentedBody = body
            .split('\n')
            .map((line) => (line === '' ? line : pad + line))
            .join('\n')
        restored = restored.replace(
            match ? placeholder : `<abide-${block.kind} data-i="${index}"></abide-${block.kind}>`,
            `${pad}${block.open}\n${indentedBody}\n${pad}${block.close}`,
        )
    }
    return restored
}

/* The block body formatted as a program, or the original on failure. */
async function formatBlockBody(body: string, parser: string, options: Options): Promise<string> {
    try {
        return (await format(body, { ...blockOptions(options), parser })).trimEnd()
    } catch {
        return body.trim()
    }
}

/* Markup-pass options: the file's width/indent, plus the HTML defaults that match
   the repo's Biome config (`bracketSameLine`, css whitespace sensitivity). */
function htmlOptions(options: Options): Options {
    return {
        parser: 'html',
        printWidth: options.printWidth,
        tabWidth: options.tabWidth,
        useTabs: options.useTabs,
        bracketSameLine: true,
        htmlWhitespaceSensitivity: 'css',
    }
}

/* The JS style for `<script>`/`<style>` bodies — the file's options re-aimed at the
   block parser (set by the caller). */
function blockOptions(options: Options): Options {
    return {
        printWidth: options.printWidth,
        tabWidth: options.tabWidth,
        useTabs: options.useTabs,
        semi: options.semi,
        singleQuote: options.singleQuote,
        quoteProps: options.quoteProps,
        trailingComma: options.trailingComma,
        bracketSpacing: options.bracketSpacing,
        arrowParens: options.arrowParens,
    }
}

/* The expression style: the JS style at a width that never wraps an interpolation. */
function expressionOptions(options: Options): Options {
    return { ...blockOptions(options), parser: '__ts_expression', printWidth: 100000 }
}
