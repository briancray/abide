import { SyntaxKind } from 'typescript/unstable/ast'

import type { AbideFile } from './parseAbide.ts'
import type { Body, InlineComponent, TemplateNode } from './TemplateNode.ts'
import { tokenize } from './tokenize.ts'

// 38.127 — WHAT `abide format` MAY CHANGE, and nothing else: the whitespace a browser collapses, a
// run's indentation where 33.17 and 33.18 read only its kind, and the code `bun fmt` printed, read as
// its tokens — a script block's in any order, since `sortImports` moves its imports. Everything else — a tag, an attribute's text, a block's shape, a line inside a template
// literal — is compared as the parser read it.

/** Whether `before` and `after` are one template, under what `abide format` may change. 38.127. */
export function sameTemplate(before: AbideFile, after: AbideFile): boolean {
    return shapeOf(before) === shapeOf(after)
}

function shapeOf(file: AbideFile): string {
    const parts: string[] = []
    for (const code of file.modules) parts.push(blockShape(code))
    for (const code of file.servers) parts.push(blockShape(code))
    for (const code of file.scripts) parts.push(blockShape(code))
    for (const style of file.styles) parts.push(styleShape(style))
    parts.push(file.generics ?? '')
    nodesShape(file.head, parts)
    if (file.document !== undefined) {
        nodesShape([file.document.html], parts)
        nodesShape([file.document.body], parts)
    }
    nodesShape(file.template, parts)
    for (const component of file.components) componentShape(component, parts)
    return parts.join('\u0000')
}

function nodesShape(nodes: TemplateNode[], parts: string[]): void {
    for (const node of nodes) {
        if (node.kind === 'text') {
            parts.push(`text ${textShape(node.text)}`)
            continue
        }
        if (node.kind === 'expression') {
            parts.push(`slot ${codeShape(node.source)}`)
            continue
        }
        if (node.kind === 'element') {
            parts.push(`<${node.tag}`)
            for (const attribute of node.attributes)
                parts.push(
                    attribute.expression
                        ? `${attribute.name}={${codeShape(attribute.value)}}`
                        : `${attribute.name}=${attribute.value}`,
                )
            nodesShape(node.children, parts)
            for (const component of node.components)
                componentShape(component, parts)
            for (const component of node.passed)
                componentShape(component, parts)
            parts.push(`</${node.tag}>`)
            continue
        }
        if (node.block === 'for') {
            parts.push(
                `{#for ${codeShape(node.item)},${codeShape(node.index)} of ${codeShape(node.subject)} by ${codeShape(node.key)}`,
            )
            bodyShape(node, parts)
        } else {
            parts.push(
                node.block === 'try'
                    ? `{#try ${node.error}`
                    : `{#${node.block}`,
            )
            for (const branch of node.branches) {
                parts.push(`{:${codeShape(branch.subject)}`)
                bodyShape(branch, parts)
            }
        }
        parts.push('{/}')
    }
}

function bodyShape(body: Body, parts: string[]): void {
    parts.push(
        body.setup === null ? '' : blockShape(body.setup.text),
        body.style === null ? '' : styleShape(body.style),
    )
    nodesShape(body.children, parts)
    for (const component of body.components) componentShape(component, parts)
}

function componentShape(component: InlineComponent, parts: string[]): void {
    parts.push(
        `{#component ${component.name}(${component.pattern}: ${component.type})`,
    )
    bodyShape(component, parts)
    parts.push('{/component}')
}

/**
 * A text node as the browser renders it: within text, every whitespace run holding a newline is one
 * space however it is indented. A node that is whitespace alone keeps its KIND — a newline alone, or
 * one carrying indentation — since 33.17 and 33.18 drop the two apart.
 */
function textShape(text: string): string {
    if (text.trim() === '') return /[ \t]/.test(text) ? '\n ' : '\n'
    return text.replace(/\s*\n\s*/g, '\n')
}

/** Code as its tokens, in order. */
function codeShape(code: string): string {
    return tokensOf(code).join(' ')
}

/** A script block's code as its tokens in any order: `bun fmt`'s `sortImports` moves its imports. */
function blockShape(code: string): string {
    return tokensOf(code).sort().join(' ')
}

/**
 * Code's tokens, with what a printer adds or drops at will taken out: the separators `;` and `,`,
 * the parentheses, and how a string or a number is spelled. A template literal's text is a token,
 * so a line moved inside one is a different token.
 */
function tokensOf(code: string): string[] {
    const tokens: string[] = []
    for (const token of tokenize(code))
        switch (token.kind) {
            case SyntaxKind.SemicolonToken:
            case SyntaxKind.CommaToken:
            case SyntaxKind.OpenParenToken:
            case SyntaxKind.CloseParenToken:
                continue
            case SyntaxKind.StringLiteral:
                tokens.push(
                    JSON.stringify(
                        token.text.slice(1, -1).replace(/\\(['"])/g, '$1'),
                    ),
                )
                continue
            case SyntaxKind.NumericLiteral:
                tokens.push(String(Number(token.text.replaceAll('_', ''))))
                continue
            default:
                tokens.push(token.text)
        }
    return tokens
}

/** A style with its whitespace and its `;`s taken out, which CSS reads none of outside a string. */
function styleShape(style: string): string {
    return style.replace(/[\s;]+/g, '')
}
