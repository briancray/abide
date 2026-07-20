// projectFormText (TODO #8 follow-up) — the multipart TEXT-field projection used to validate a
// multipart mutation's non-File fields against the JSON `input` schema.

import { describe, expect, test } from 'bun:test'
import type { StandardSchemaV1 } from '../../shared/StandardSchema.ts'
import { projectFormText } from './projectFormText.ts'

const SCHEMA = {
    type: 'object',
    properties: {
        caption: { type: 'string' },
        count: { type: 'number' },
        ratio: { type: 'integer' },
        active: { type: 'boolean' },
        tags: { type: 'array' },
    },
} as const

describe('projectFormText', () => {
    test('excludes File entries — a File never reaches the projected object', () => {
        const form = new FormData()
        form.set('caption', 'hi')
        form.set('avatar', new File(['y'], 'y.txt'))
        const out = projectFormText(form, SCHEMA)
        expect(out).toEqual({ caption: 'hi' })
        expect('avatar' in out).toBe(false)
    })

    test('coerces strings to the declared type', () => {
        const form = new FormData()
        form.set('count', '42')
        form.set('ratio', '7')
        form.set('active', 'true')
        form.set('tags', '["a","b"]')
        const out = projectFormText(form, SCHEMA)
        expect(out).toEqual({ count: 42, ratio: 7, active: true, tags: ['a', 'b'] })
    })

    test('leaves an uncoercible value as the raw string (validation reports the mismatch)', () => {
        const form = new FormData()
        form.set('count', 'not-a-number')
        form.set('ratio', '1.5') // integer but fractional → left raw
        const out = projectFormText(form, SCHEMA)
        expect(out.count).toBe('not-a-number')
        expect(out.ratio).toBe('1.5')
    })

    test('leaves undeclared / untyped fields as strings', () => {
        const form = new FormData()
        form.set('unknown', '123')
        const out = projectFormText(form, SCHEMA)
        expect(out.unknown).toBe('123')
    })

    test('promotes repeated keys to an array (FormData.getAll semantics)', () => {
        const form = new FormData()
        form.append('caption', 'a')
        form.append('caption', 'b')
        const out = projectFormText(form, SCHEMA)
        expect(out.caption).toEqual(['a', 'b'])
    })

    test('an opaque Standard Schema yields raw strings (no framework coercion)', () => {
        const standard: StandardSchemaV1 = {
            '~standard': { version: 1, vendor: 'test', validate: (v: unknown) => ({ value: v }) },
        }
        const form = new FormData()
        form.set('count', '42')
        const out = projectFormText(form, standard)
        expect(out.count).toBe('42')
    })
})
