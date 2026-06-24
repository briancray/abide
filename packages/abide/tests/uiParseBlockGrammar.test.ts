import { describe, expect, test } from 'bun:test'
import { parseTemplate } from '../src/lib/ui/compile/parseTemplate.ts'

/* The block tokenizer must emit the SAME AST the `<template>` directives do. */
describe('block grammar — if chain', () => {
    test('{#if}{:else if}{:else}{/if} → if node with case branches', () => {
        const { nodes } = parseTemplate(
            `{#if a}<span>A</span>{:else if b}<span>B</span>{:else}<span>C</span>{/if}`,
        )
        expect(nodes).toHaveLength(1)
        const ifNode = nodes[0]
        expect(ifNode.kind).toBe('if')
        if (ifNode.kind !== 'if') throw new Error('not if')
        expect(ifNode.condition).toBe('a')
        // children: [then <span>A</span>, case(elseif b), case(else)]
        const elseif = ifNode.children.find((n) => n.kind === 'case' && n.condition === 'b')
        expect(elseif).toBeDefined()
        const elseBranch = ifNode.children.find(
            (n) => n.kind === 'case' && n.match === undefined && n.condition === undefined,
        )
        expect(elseBranch).toBeDefined()
        // then-content (the <span>A</span>) precedes the first case
        const firstCase = ifNode.children.findIndex((n) => n.kind === 'case')
        const thenContent = ifNode.children.slice(0, firstCase)
        expect(thenContent.some((n) => n.kind === 'element' && n.tag === 'span')).toBe(true)
    })

    test('bare {#if cond} keeps the condition expression verbatim', () => {
        const { nodes } = parseTemplate(`{#if user.isAdmin && count > 0}<b>x</b>{/if}`)
        expect(nodes[0].kind).toBe('if')
        if (nodes[0].kind !== 'if') throw new Error('not if')
        expect(nodes[0].condition).toBe('user.isAdmin && count > 0')
    })

    test('plain {expr} interpolation is NOT treated as a block', () => {
        const { nodes } = parseTemplate(`<p>{name}</p>`)
        expect(nodes[0].kind).toBe('element')
    })
})
