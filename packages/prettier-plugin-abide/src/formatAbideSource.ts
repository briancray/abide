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
    // Shield component tags from the HTML pass, which lowercases recognized HTML
    // tag names (`Button` -> `button`, `Input` -> `input`) — silently demoting a
    // component to a dead native element. Each PascalCase name maps to an inert
    // all-lowercase placeholder Prettier leaves untouched, restored after reflow.
    const { protectedSource, componentNames } = protectComponentTags(masked)
    let output: string
    try {
        output = await format(protectedSource, htmlOptions(options))
    } catch {
        return source
    }
    output = restoreComponentTags(output, componentNames)
    output = await restoreExpressions(output, expressions, options)
    return restoreBlocks(output, blocks, options)
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'

/* An inert, all-lowercase stand-in for a component tag, kept the SAME length as the
   original name so the markup pass makes identical line-wrap decisions (a longer
   token would spuriously wrap attributes). Built from the lowercased name with its
   last char(s) overwritten by the index — unique across components, never a real
   HTML tag, and untouched by Prettier (unknown elements keep case + self-closing). */
function componentPlaceholder(name: string, index: number): string {
    const chars = name.toLowerCase().split('')
    const last = chars.length - 1
    chars[last] = ALPHABET[index % 26] as string
    if (index >= 26 && last >= 1) {
        chars[last - 1] = ALPHABET[Math.floor(index / 26) % 26] as string
    }
    return chars.join('')
}

/* Rewrites every PascalCase tag name (open and close) to its placeholder, in
   first-seen order, so the markup pass treats components as inert custom elements
   instead of HTML it may lowercase. Scans with the same text/tag/quote awareness as
   scanRegions so only a real tag-name position is touched — never a `<Generic<T>>`
   inside a quoted attribute value, where `<` is literal. */
function protectComponentTags(masked: string): {
    protectedSource: string
    componentNames: string[]
} {
    const componentNames: string[] = []
    const indexOfName = new Map<string, number>()
    const length = masked.length
    let output = ''
    let cursor = 0
    let state: 'text' | 'tag' = 'text'
    while (cursor < length) {
        const char = masked.charAt(cursor)
        if (state === 'text') {
            if (char === '<') {
                // A `<` in element flow always opens a tag; read its (optional `/` +)
                // name and, when PascalCase, swap it for the placeholder.
                let nameStart = cursor + 1
                const closing = masked.charAt(nameStart) === '/'
                if (closing) {
                    nameStart += 1
                }
                let nameEnd = nameStart
                while (nameEnd < length && /[A-Za-z0-9]/.test(masked.charAt(nameEnd))) {
                    nameEnd += 1
                }
                const name = masked.slice(nameStart, nameEnd)
                if (/^[A-Z]/.test(name)) {
                    let index = indexOfName.get(name)
                    if (index === undefined) {
                        index = componentNames.length
                        componentNames.push(name)
                        indexOfName.set(name, index)
                    }
                    output += `<${closing ? '/' : ''}${componentPlaceholder(name, index)}`
                    cursor = nameEnd
                } else {
                    output += char
                    cursor += 1
                }
                state = 'tag'
            } else {
                output += char
                cursor += 1
            }
        } else if (char === '"' || char === "'") {
            // Quoted attribute value: copied verbatim, so a `<` inside stays literal.
            const quote = char
            output += char
            cursor += 1
            while (cursor < length && masked.charAt(cursor) !== quote) {
                output += masked.charAt(cursor)
                cursor += 1
            }
            // Emit the closing quote so the next iteration doesn't reopen it.
            if (cursor < length) {
                output += masked.charAt(cursor)
                cursor += 1
            }
        } else {
            if (char === '>') {
                state = 'text'
            }
            output += char
            cursor += 1
        }
    }
    return { protectedSource: output, componentNames }
}

/* Restores each placeholder tag back to its original PascalCase component name. */
function restoreComponentTags(output: string, componentNames: string[]): string {
    let restored = output
    componentNames.forEach((name, index) => {
        const placeholder = componentPlaceholder(name, index)
        // The lookahead pins the whole tag name (a placeholder can be a prefix of a
        // longer one, e.g. `modaa` in `modaaa`); placeholders are letters-only, so
        // no regex escaping is needed.
        restored = restored.replace(new RegExp(`(</?)${placeholder}(?=[\\s/>])`, 'g'), `$1${name}`)
    })
    return restored
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
        /* Function replacers insert their return value literally — a string
           replacement would interpret `$&`, `$1`, `` $` ``, `$'`, `$$` inside the
           formatted code as special patterns and corrupt the output. */
        restored = restored
            .replace(new RegExp(`=(["'])${token}\\1`), () => `={${code}}`)
            .replace(token, () => `{${code}}`)
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
        const placeholder = new RegExp(
            `^([ \\t]*)<abide-${block.kind} data-i="${index}"></abide-${block.kind}>`,
            'm',
        )
        const match = restored.match(placeholder)
        const pad = match?.[1] ?? ''
        /* Strip the indent that will be re-added below BEFORE formatting. Prettier
           reindents code on its own, but copies the interior of block comments and
           multi-line template literals verbatim — so re-indenting those by `pad`
           every pass would compound their leading whitespace. Dedenting by `pad`
           first makes the re-indent cancel out, leaving such interiors fixed. */
        const body = await formatBlockBody(dedent(block.body, pad.length), parser, options)
        const indentedBody = body
            .split('\n')
            .map((line) => (line === '' ? line : pad + line))
            .join('\n')
        /* Function replacer: the formatted body inserts literally, so special
           replacement patterns (`$&`, `$1`, …) in the user's code stay intact. */
        restored = restored.replace(
            match ? placeholder : `<abide-${block.kind} data-i="${index}"></abide-${block.kind}>`,
            () => `${pad}${block.open}\n${indentedBody}\n${pad}${block.close}`,
        )
    }
    return restored
}

/* Removes up to `amount` leading spaces/tabs from every line — the inverse of the
   re-indent applied after formatting, so verbatim-preserved spans (comment and
   template-literal interiors) round-trip unchanged instead of accumulating indent. */
function dedent(text: string, amount: number): string {
    if (amount === 0) {
        return text
    }
    return text
        .split('\n')
        .map((line) => {
            let cut = 0
            while (cut < amount && (line[cut] === ' ' || line[cut] === '\t')) {
                cut += 1
            }
            return line.slice(cut)
        })
        .join('\n')
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
