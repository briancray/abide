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

describe('block grammar — for', () => {
    test('{#for a of xs} → each with defaults', () => {
        const { nodes } = parseTemplate(`{#for item of items}<li>{item}</li>{/for}`)
        expect(nodes[0]).toMatchObject({
            kind: 'each',
            items: 'items',
            as: 'item',
            index: undefined,
            key: undefined,
            async: false,
        })
    })

    test('{#for a, i of xs by k} → each with index and key', () => {
        const { nodes } = parseTemplate(`{#for item, i of items by item.id}<li>{i}</li>{/for}`)
        expect(nodes[0]).toMatchObject({
            kind: 'each',
            items: 'items',
            as: 'item',
            index: 'i',
            key: 'item.id',
            async: false,
        })
    })

    test('destructuring binding is preserved, comma split is depth-aware', () => {
        const { nodes } = parseTemplate(`{#for {id, title} of posts by id}<li>{title}</li>{/for}`)
        expect(nodes[0]).toMatchObject({
            kind: 'each',
            as: '{id, title}',
            items: 'posts',
            key: 'id',
            index: undefined,
        })
    })

    test('{#for await a of xs} → async each, with {:catch}', () => {
        const { nodes } = parseTemplate(
            `{#for await row of stream}<li>{row}</li>{:catch e}<b>{e}</b>{/for}`,
        )
        const each = nodes[0]
        expect(each).toMatchObject({ kind: 'each', items: 'stream', as: 'row', async: true })
        if (each.kind !== 'each') throw new Error('not each')
        expect(each.children.some((n) => n.kind === 'branch' && n.branch === 'catch')).toBe(true)
    })
})

describe('block grammar — await', () => {
    test('streaming {#await}{:then}{:catch}{:finally}', () => {
        const { nodes } = parseTemplate(
            `{#await load()}<p>loading</p>{:then v}<span>{v}</span>{:catch e}<b>{e}</b>{:finally}<i>done</i>{/await}`,
        )
        const a = nodes[0]
        expect(a).toMatchObject({
            kind: 'await',
            promise: 'load()',
            blocking: false,
            as: undefined,
        })
        if (a.kind !== 'await') throw new Error('not await')
        // pending content precedes the first branch
        const firstBranch = a.children.findIndex((n) => n.kind === 'branch')
        expect(
            a.children.slice(0, firstBranch).some((n) => n.kind === 'element' && n.tag === 'p'),
        ).toBe(true)
        expect(a.children).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ kind: 'branch', branch: 'then', as: 'v' }),
                expect.objectContaining({ kind: 'branch', branch: 'catch', as: 'e' }),
                expect.objectContaining({ kind: 'branch', branch: 'finally', as: undefined }),
            ]),
        )
    })

    test('blocking {#await p then v}', () => {
        const { nodes } = parseTemplate(`{#await user() then u}<span>{u.name}</span>{/await}`)
        expect(nodes[0]).toMatchObject({
            kind: 'await',
            promise: 'user()',
            blocking: true,
            as: 'u',
        })
    })

    test('then-as-keyword does not split an expression containing the word then', () => {
        const { nodes } = parseTemplate(
            `{#await q.then(x)}<p>w</p>{:then v}<span>{v}</span>{/await}`,
        )
        expect(nodes[0]).toMatchObject({ kind: 'await', promise: 'q.then(x)', blocking: false })
    })
})
