import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'
import { jsonSchemaForType } from '../src/lib/shared/jsonSchemaForType.ts'

/* A throwaway project on disk — the checker resolves the named type aliases from real files. Each
   alias' declared type is fed to the projector, so the suite exercises the ts.Type → JSON Schema
   projection over the subset abide's json()/jsonl() emit (ADR-0030 D2). */
const SOURCE = `
export type Str = string
export type Lit = 'a'
export type StrUnion = 'a' | 'b'
export type Num = number
export type NumLit = 42
export type Bool = boolean
export type Nul = null
export type Big = bigint
export type When = Date
export type SetT = Set<string>
export type MapT = Map<string, number>
export type Obj = { a: string; b?: number }
export type ObjBearsUndefined = { a: string; c: number | undefined }
export type Rec = Record<string, number>
export type Arr = string[]
export type ROArr = readonly number[]
export type Tup = [string, number]
export type Uni = string | number
export type OptUni = string | undefined
export type AnyT = any
export type UnknownT = unknown
export type Tree = { value: number; children: Tree[] }
`

const dir = mkdtempSync(join(tmpdir(), 'abide-project-'))
writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify({
        compilerOptions: {
            strict: true,
            module: 'esnext',
            moduleResolution: 'bundler',
            target: 'esnext',
            lib: ['esnext', 'dom'],
        },
    }),
)
const typesPath = join(dir, 'types.ts')
writeFileSync(typesPath, SOURCE)

const program = ts.createProgram({
    rootNames: [typesPath],
    options: {
        strict: true,
        target: ts.ScriptTarget.ESNext,
        lib: ['lib.esnext.d.ts', 'lib.dom.d.ts'],
    },
})
const checker = program.getTypeChecker()
const sourceFile = program.getSourceFile(typesPath)

/* The projected schema for a named type alias — resolves the alias' declared type through the checker
   and runs the projector. */
function schemaOf(name: string): Record<string, unknown> | undefined {
    for (const statement of sourceFile?.statements ?? []) {
        if (ts.isTypeAliasDeclaration(statement) && statement.name.text === name) {
            const symbol = checker.getSymbolAtLocation(statement.name)
            if (symbol === undefined) {
                throw new Error(`no symbol for ${name}`)
            }
            return jsonSchemaForType(checker, checker.getDeclaredTypeOfSymbol(symbol))
        }
    }
    throw new Error(`no type alias ${name}`)
}

describe('jsonSchemaForType — primitives and literals', () => {
    test('string → { type: string }', () => {
        expect(schemaOf('Str')).toEqual({ type: 'string' })
    })

    test('string literal → { type: string, const }', () => {
        expect(schemaOf('Lit')).toEqual({ type: 'string', const: 'a' })
    })

    test('union of string literals → { enum }', () => {
        expect(schemaOf('StrUnion')).toEqual({ enum: ['a', 'b'] })
    })

    test('number and numeric literal → { type: number }', () => {
        expect(schemaOf('Num')).toEqual({ type: 'number' })
        expect(schemaOf('NumLit')).toEqual({ type: 'number' })
    })

    test('boolean → { type: boolean }', () => {
        expect(schemaOf('Bool')).toEqual({ type: 'boolean' })
    })

    test('null → { type: null }', () => {
        expect(schemaOf('Nul')).toEqual({ type: 'null' })
    })

    test('bigint → { type: string } (no JSON bigint; ADR-0029 wire rep)', () => {
        expect(schemaOf('Big')).toEqual({ type: 'string' })
    })

    test('Date → { type: string, format: date-time }', () => {
        expect(schemaOf('When')).toEqual({ type: 'string', format: 'date-time' })
    })

    /* ADR-0029 wire coherence: the projected schema MUST match the bytes the wireJsonReplacer emits —
       a Set rides as an array of its values, a Map as an array of [key, value] entry tuples. */
    test('Set<T> → { type: array, items } (matches the encoded wire array)', () => {
        expect(schemaOf('SetT')).toEqual({ type: 'array', items: { type: 'string' } })
    })

    test('Map<K, V> → an array of [K, V] entry tuples (matches the encoded wire entries)', () => {
        expect(schemaOf('MapT')).toEqual({
            type: 'array',
            items: {
                type: 'array',
                prefixItems: [{ type: 'string' }, { type: 'number' }],
                items: false,
            },
        })
    })
})

describe('jsonSchemaForType — objects and required', () => {
    test('object → properties + required (optional and undefined-bearing excluded)', () => {
        expect(schemaOf('Obj')).toEqual({
            type: 'object',
            properties: { a: { type: 'string' }, b: { type: 'number' } },
            required: ['a'],
        })
    })

    test('an undefined-bearing property is non-required and strips undefined from its schema', () => {
        expect(schemaOf('ObjBearsUndefined')).toEqual({
            type: 'object',
            properties: { a: { type: 'string' }, c: { type: 'number' } },
            required: ['a'],
        })
    })

    test('Record<string, V> → additionalProperties', () => {
        expect(schemaOf('Rec')).toEqual({
            type: 'object',
            additionalProperties: { type: 'number' },
        })
    })
})

describe('jsonSchemaForType — arrays, tuples, unions', () => {
    test('T[] → { type: array, items }', () => {
        expect(schemaOf('Arr')).toEqual({ type: 'array', items: { type: 'string' } })
    })

    test('readonly T[] → { type: array, items }', () => {
        expect(schemaOf('ROArr')).toEqual({ type: 'array', items: { type: 'number' } })
    })

    test('tuple → prefixItems with items: false', () => {
        expect(schemaOf('Tup')).toEqual({
            type: 'array',
            prefixItems: [{ type: 'string' }, { type: 'number' }],
            items: false,
        })
    })

    test('a mixed union → anyOf', () => {
        expect(schemaOf('Uni')).toEqual({ anyOf: [{ type: 'string' }, { type: 'number' }] })
    })

    test('optional union (T | undefined) strips undefined to the lone member', () => {
        expect(schemaOf('OptUni')).toEqual({ type: 'string' })
    })
})

describe('jsonSchemaForType — fail-open and cycle guard', () => {
    test('any → undefined (permissive, omitted at the top level)', () => {
        expect(schemaOf('AnyT')).toBeUndefined()
    })

    test('unknown → undefined', () => {
        expect(schemaOf('UnknownT')).toBeUndefined()
    })

    test('a recursive type terminates — the self-reference collapses to {}', () => {
        expect(schemaOf('Tree')).toEqual({
            type: 'object',
            properties: {
                value: { type: 'number' },
                children: { type: 'array', items: {} },
            },
            required: ['value', 'children'],
        })
    })
})
