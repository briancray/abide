import { describe, expect, test } from 'bun:test'
import ts from 'typescript'
import {
    reactiveImportBindings,
    resolveReactiveExport,
} from '../src/lib/ui/compile/resolveReactiveExport.ts'

/* Parses a snippet and resolves the callee of its first call expression against
   the file's own import bindings — the exact shape the compiler passes. */
function resolve(snippet: string): string | undefined {
    const source = ts.createSourceFile('snippet.ts', snippet, ts.ScriptTarget.Latest, true)
    const bindings = reactiveImportBindings(source)
    let callee: ts.Expression | undefined
    const visit = (node: ts.Node): void => {
        if (callee === undefined && ts.isCallExpression(node)) {
            callee = node.expression
        }
        ts.forEachChild(node, visit)
    }
    visit(source)
    return callee === undefined ? undefined : resolveReactiveExport(callee, bindings)
}

describe('resolveReactiveExport — import-binding resolution, checker-free', () => {
    test('a direct state import resolves a bare call', () => {
        expect(resolve(`import { state } from '@abide/abide/ui/state'\nstate(0)`)).toBe('state')
    })

    test('an aliased state import resolves its alias', () => {
        expect(resolve(`import { state as s } from '@abide/abide/ui/state'\ns(0)`)).toBe('state')
    })

    test('state.computed / state.linked member calls resolve off the state root', () => {
        expect(
            resolve(`import { state } from '@abide/abide/ui/state'\nstate.computed(() => 0)`),
        ).toBe('computed')
        expect(
            resolve(`import { state } from '@abide/abide/ui/state'\nstate.linked(() => 0)`),
        ).toBe('linked')
    })

    test('member calls resolve off an aliased state root too', () => {
        expect(
            resolve(`import { state as s } from '@abide/abide/ui/state'\ns.computed(() => 0)`),
        ).toBe('computed')
    })

    test('an aliased effect import resolves', () => {
        expect(resolve(`import { effect as fx } from '@abide/abide/ui/effect'\nfx(() => {})`)).toBe(
            'effect',
        )
    })

    test("a user's own `state` function (no matching import) does not resolve", () => {
        expect(resolve(`const state = () => 0\nstate()`)).toBeUndefined()
    })

    test('a non-state root member call does not resolve', () => {
        expect(resolve(`const obj = { computed(){} }\nobj.computed()`)).toBeUndefined()
    })
})
