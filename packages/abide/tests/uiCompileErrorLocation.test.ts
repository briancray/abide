import { describe, expect, test } from 'bun:test'
import { compileComponent } from '../src/lib/ui/compile/compileComponent.ts'
import { offsetToLineColumn } from '../src/lib/ui/compile/offsetToLineColumn.ts'

/* The full range model accepts ANY content in a control-flow branch or each row —
   the cases that used to be rejected (a nested control-flow `<template>`, a
   multi-node each row) now compile. */
describe('control-flow accepts arbitrary branch / row content', () => {
    test('a nested control-flow template directly in an if branch compiles', () => {
        expect(() =>
            compileComponent(
                `<template if={show}><template if={inner}><b>x</b></template></template>`,
            ),
        ).not.toThrow()
    })

    test('a multi-node each row compiles', () => {
        expect(() =>
            compileComponent(
                `<template each={items} as="item"><span>{item}</span><span>x</span></template>`,
            ),
        ).not.toThrow()
    })
})

describe('offsetToLineColumn', () => {
    test('maps offsets to 1-based line/column', () => {
        const source = 'ab\ncde\nf'
        expect(offsetToLineColumn(source, 0)).toEqual({ line: 1, column: 1 })
        expect(offsetToLineColumn(source, 3)).toEqual({ line: 2, column: 1 })
        expect(offsetToLineColumn(source, 5)).toEqual({ line: 2, column: 3 })
        expect(offsetToLineColumn(source, 7)).toEqual({ line: 3, column: 1 })
    })
})
