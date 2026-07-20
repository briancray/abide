// Output-shaping (rpc-core §5.2) — trimming a value to its declared JSON Schema fields.

import { describe, expect, test } from 'bun:test'
import type { StandardSchemaV1 } from '../StandardSchema.ts'
import type { JSONSchema } from './jsonSchema.ts'
import { jsonSchemaOf, shapeToSchema } from './shapeToSchema.ts'

describe('shapeToSchema', () => {
    test('drops undeclared object fields (the passwordHash leak)', () => {
        const schema: JSONSchema = {
            type: 'object',
            properties: { id: { type: 'number' }, name: { type: 'string' } },
        }
        const shaped = shapeToSchema({ id: 1, name: 'ada', passwordHash: 'secret' }, schema)
        expect(shaped).toEqual({ id: 1, name: 'ada' })
    })

    test('keeps undeclared fields when additionalProperties is true', () => {
        const schema: JSONSchema = {
            type: 'object',
            properties: { id: { type: 'number' } },
            additionalProperties: true,
        }
        const shaped = shapeToSchema({ id: 1, extra: 'kept' }, schema)
        expect(shaped).toEqual({ id: 1, extra: 'kept' })
    })

    test('shapes undeclared fields through an additionalProperties schema', () => {
        const schema: JSONSchema = {
            type: 'object',
            properties: {},
            additionalProperties: { type: 'object', properties: { n: { type: 'number' } } },
        }
        const shaped = shapeToSchema({ a: { n: 1, drop: true } }, schema)
        expect(shaped).toEqual({ a: { n: 1 } })
    })

    test('recurses into nested objects', () => {
        const schema: JSONSchema = {
            type: 'object',
            properties: { user: { type: 'object', properties: { id: { type: 'number' } } } },
        }
        const shaped = shapeToSchema({ user: { id: 1, token: 'x' }, top: 'drop' }, schema)
        expect(shaped).toEqual({ user: { id: 1 } })
    })

    test('shapes array items', () => {
        const schema: JSONSchema = {
            type: 'array',
            items: { type: 'object', properties: { id: { type: 'number' } } },
        }
        const shaped = shapeToSchema(
            [
                { id: 1, secret: 'a' },
                { id: 2, secret: 'b' },
            ],
            schema,
        )
        expect(shaped).toEqual([{ id: 1 }, { id: 2 }])
    })

    test('permissive object schema (no properties) passes through unchanged', () => {
        const shaped = shapeToSchema({ anything: 1, goes: 2 }, { type: 'object' })
        expect(shaped).toEqual({ anything: 1, goes: 2 })
    })

    test('absent schema passes the value through unchanged', () => {
        const value = { id: 1, secret: 'keep-when-no-schema' }
        expect(shapeToSchema(value, undefined)).toBe(value)
    })

    test('null and primitives pass through', () => {
        expect(shapeToSchema(null, { type: 'object', properties: {} })).toBeNull()
        expect(shapeToSchema(42, { type: 'number' })).toBe(42)
    })
})

describe('jsonSchemaOf', () => {
    test('returns a raw JSON Schema', () => {
        const schema: JSONSchema = { type: 'object', properties: { id: { type: 'number' } } }
        expect(jsonSchemaOf(schema)).toBe(schema)
    })

    test('returns undefined for a Standard Schema (opaque field set)', () => {
        const standard: StandardSchemaV1 = {
            '~standard': { version: 1, vendor: 'test', validate: (v) => ({ value: v }) },
        }
        expect(jsonSchemaOf(standard)).toBeUndefined()
    })

    test('returns undefined for undefined / non-schema values', () => {
        expect(jsonSchemaOf(undefined)).toBeUndefined()
        expect(jsonSchemaOf({} as JSONSchema)).toBeUndefined()
    })
})
